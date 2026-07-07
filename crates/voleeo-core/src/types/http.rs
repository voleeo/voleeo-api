//! HTTP request, folder, and response/timeline/SSE types.

use super::common::{EnvironmentVariable, RequestParameter};
use crate::auth::{is_auth_none, AuthConfig};
use crate::cookies::StoredCookie;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BodyKind {
    #[default]
    None,
    Json,
    Xml,
    Text,
    Html,
    FormUrlEncoded,
    Multipart,
    Binary,
    Graphql,
}

/// One field of a form-urlencoded or multipart body. `is_file` (multipart only)
/// flags a file attachment whose `value` is an absolute path read at send time.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BodyField {
    pub id: String,
    pub name: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default)]
    pub is_file: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

/// `text` carries raw bodies (json/xml/text/html). `fields` carries
/// form-urlencoded / multipart entries. `file_path` carries the binary upload.
/// New fields are `Option` so existing `{ kind, text }` payloads stay valid.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestBody {
    pub kind: BodyKind,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<BodyField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// GraphQL variables (JSON object string). Only meaningful for `Graphql`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphql_variables: Option<String>,
}

impl RequestBody {
    pub fn graphql_payload(&self) -> String {
        let variables: serde_json::Value = self
            .graphql_variables
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);
        serde_json::json!({ "query": self.text, "variables": variables }).to_string()
    }
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    pub model: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub method: String,
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<RequestParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<RequestParameter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<RequestBody>,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub order: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiFolder {
    pub id: String,
    #[serde(rename = "type")]
    pub folder_type: String,
    pub model: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    /// Applied to requests in this folder + subfolders; nearest scope wins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<RequestParameter>,
    /// Folder-level auth. Requests can opt in via `AuthConfig::Inherit`.
    #[serde(default, skip_serializing_if = "is_auth_none")]
    pub auth: AuthConfig,
    /// Variables for requests in this folder + subfolders (`{{ KEY }}`). Nearest
    /// folder wins over ancestors, folders win over envs. Ciphertext at rest.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<EnvironmentVariable>,
    /// Accent color (hex `#rrggbb`) for the folder icon; `None` = theme default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub order: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseHeader {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub at_ms: f64,
}

/// One Timeline-tab row; `at_ms` is elapsed from request start. `kind` is a
/// string (not an enum) so the executor can add types without breaking codegen.
/// Today: `config` | `info` | `send` | `recv` | `dns` | `chunk` | `done`.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub at_ms: f64,
    pub kind: String,
    pub text: String,
}

/// One frame parsed from a `text/event-stream` response and pushed to the UI
/// live. `seq` is the 0-based arrival order within a send (the React key);
/// `data` joins multiple `data:` lines with `\n`. Omitted fields were absent in
/// the frame.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SseFrame {
    pub seq: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_event_id: Option<String>,
    /// SSE reconnect hint (ms). `u32` keeps it JS-number / specta safe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry: Option<u32>,
    pub at_ms: f64,
}

/// Phase timings (ms). DNS/TCP/TLS aren't available from the client → 0.0.
/// `first_byte_ms` = start→headers; `download_ms` = headers→body read.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpTiming {
    pub dns_ms: f64,
    pub connect_ms: f64,
    pub tls_ms: f64,
    pub first_byte_ms: f64,
    pub download_ms: f64,
    pub total_ms: f64,
}

/// Warning surfaced when following redirects silently dropped part of the
/// request, so the result isn't mistaken for a server-side problem.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedirectInfo {
    pub hop_count: u32,
    /// Body dropped when a 301/302/303 downgraded a non-GET request.
    pub body_dropped: bool,
    /// Sensitive headers stripped on a cross-origin redirect.
    pub dropped_headers: Vec<String>,
}

/// Result of executing a saved `HttpRequest` in-app (not the raw HTTP `Response` type).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub request_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<HttpResponseHeader>,
    /// UTF-8 body or lossy; non-text bodies are base64-encoded. Empty when
    /// `body_windowed` — the body then lives in a side file fetched in windows.
    pub body: String,
    /// Byte length of the response body (`u32` for JS number / specta interop; max ~4GiB).
    pub body_size: u32,
    pub body_is_text: bool,
    /// Large text bodies are stored out-of-line and read by line window via
    /// `response_body_window`; `body` is empty and the frontend virtualizes.
    #[serde(default)]
    pub body_windowed: bool,
    /// Line count of the stored (formatted) body — sizes the virtual viewport.
    #[serde(default)]
    pub body_line_count: u32,
    /// History id used to fetch windows/search; assigned on store, else empty.
    #[serde(default)]
    pub response_id: String,
    pub timing: HttpTiming,
    /// Timeline event log; when empty the frontend reconstructs milestones
    /// from `headers` + `timing`.
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
    /// Present when redirects dropped the body or sensitive headers.
    #[serde(default)]
    pub redirect_warning: Option<RedirectInfo>,
    /// Cookies from `Set-Cookie` (incl. redirect hops). Plaintext; the command
    /// layer encrypts on write when the workspace is encrypted.
    #[serde(default)]
    pub captured_cookies: Vec<StoredCookie>,
    /// Cookies the executor sent (active jar, matched at send time). Aggregated
    /// across hops, deduped by id.
    #[serde(default)]
    pub attached_cookies: Vec<StoredCookie>,
    /// Parsed frames for a `text/event-stream` response. Empty for normal
    /// responses; the body stays empty when this is populated. Persisted with
    /// the response so each run keeps its stream in history.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sse_frames: Vec<SseFrame>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_payload_wraps_query_and_variables() {
        let with_vars = RequestBody {
            kind: BodyKind::Graphql,
            text: "query Q($c: ID!) { country(code: $c) { name } }".into(),
            graphql_variables: Some(r#"{"c":"UA"}"#.into()),
            ..Default::default()
        };
        let v: serde_json::Value = serde_json::from_str(&with_vars.graphql_payload()).unwrap();
        assert_eq!(
            v["query"],
            "query Q($c: ID!) { country(code: $c) { name } }"
        );
        assert_eq!(v["variables"]["c"], "UA");

        let no_vars = RequestBody {
            kind: BodyKind::Graphql,
            text: "{ me }".into(),
            ..Default::default()
        };
        let v: serde_json::Value = serde_json::from_str(&no_vars.graphql_payload()).unwrap();
        assert!(v["variables"].is_null());
    }
}
