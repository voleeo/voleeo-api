use crate::cookies::StoredCookie;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "syncDir")]
    pub sync_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "keyCheck")]
    pub key_check: Option<String>,
    /// Merged into every request; folder/request headers override (case-insensitive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<RequestParameter>,
    /// Fallback auth for `AuthConfig::Inherit` when no ancestor folder defines one.
    #[serde(default, skip_serializing_if = "is_auth_none")]
    pub auth: AuthConfig,
    /// Per-workspace DNS overrides — resolved at send time, scoped to requests
    /// from this workspace (like `/etc/hosts` but local to Voleeo).
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        rename = "dnsOverrides"
    )]
    pub dns_overrides: Vec<DnsOverride>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// One DNS override row. `address` is parsed as `IpAddr` (v4 or v6) at apply
/// time; storing it as a string keeps the YAML readable and lets us roundtrip
/// invalid drafts the user is still editing without losing them.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsOverride {
    pub id: String,
    pub enabled: bool,
    pub hostname: String,
    pub address: String,
}

fn default_true() -> bool {
    true
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentVariable {
    pub key: String,
    /// Plaintext on the IPC wire; on disk this is ciphertext (`enc:v1:...`) when `encrypted` is true.
    pub value: String,
    pub encrypted: bool,
    /// When false, skipped during interpolation. Pre-field YAML reads as enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EnvironmentKind {
    Personal,
    Global,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub workspace_id: String,
    pub kind: EnvironmentKind,
    pub name: String,
    pub color: String,
    pub shared: bool,
    pub variables: Vec<EnvironmentVariable>,
    pub created_at: String,
    pub updated_at: String,
}

/// Which scope an `AuthConfig::Inherit` resolves against.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InheritSource {
    /// Nearest ancestor folder with an auth, else the workspace. Default.
    #[default]
    Folder,
    /// The workspace's own auth, skipping folders entirely.
    Workspace,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthConfig {
    #[default]
    None,
    /// Request-only, resolved at send time. `from` picks the scope: nearest
    /// ancestor folder with an auth (default), or the workspace.
    Inherit {
        #[serde(default)]
        from: InheritSource,
    },
    Bearer {
        token: String,
        #[serde(default)]
        token_encrypted: bool,
    },
    Basic {
        username: String,
        password: String,
        #[serde(default)]
        password_encrypted: bool,
    },
    ApiKey {
        key: String,
        value: String,
        location: ApiKeyLocation,
        #[serde(default)]
        value_encrypted: bool,
    },
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

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

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestParameter {
    pub id: String,
    pub name: String,
    pub value: String,
    pub enabled: bool,
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

fn is_auth_none(a: &AuthConfig) -> bool {
    matches!(a, AuthConfig::None)
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Request,
    Folder,
    WebSocket,
    Grpc,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoveItemUpdate {
    pub id: String,
    pub kind: ItemKind,
    pub folder_id: Option<String>,
    pub order: f64,
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
}

/// A WebSocket message payload encoding. `Text` carries UTF-8; `Binary`
/// carries base64 (mirrors `HttpResponse.body`'s non-text convention).
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WsMessageKind {
    #[default]
    Text,
    Binary,
}

/// Which way a transcript message traveled.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WsDirection {
    Outgoing,
    Incoming,
}

/// A saved WebSocket connection — the WS counterpart of `HttpRequest`. Lives in
/// the same workspace tree (`ws_{id}.yaml`); `auth` + `headers` ride the
/// handshake; `parameters` mirror HTTP path/query params (`:name` segments in
/// the URL bind to `parameters` by name; the rest become the query string).
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WsConnection {
    pub id: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub model: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<RequestParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<RequestParameter>,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub order: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// One transcript row. `size` is the byte length of the decoded payload (`u32`
/// for JS-number/specta interop). `at` is a UTC ISO-8601 timestamp.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WsMessage {
    pub id: String,
    pub direction: WsDirection,
    pub kind: WsMessageKind,
    pub data: String,
    pub size: u32,
    pub at: String,
}

/// Where a gRPC request's protobuf schema comes from. `Reflection` queries the
/// server's reflection service at send time; `Files` compiles local `.proto`s
/// (absolute paths) — files are referenced, never copied into the workspace.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtoSource {
    #[default]
    Reflection,
    Files {
        paths: Vec<String>,
        #[serde(default)]
        include_dirs: Vec<String>,
    },
}

/// The four gRPC call shapes, derived from the method descriptor's
/// client/server streaming flags.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrpcRpcKind {
    Unary,
    ServerStreaming,
    ClientStreaming,
    Bidi,
}

/// A saved gRPC request — the gRPC counterpart of `HttpRequest`/`WsConnection`.
/// Lives in the workspace tree as `grpc_{id}.yaml`. `message` is the request
/// payload in protobuf-JSON (the form editor, MCP, and the dynamic codec all
/// share this single representation). `metadata` rides the call as gRPC
/// metadata (HTTP/2 headers); `auth` maps to metadata at send time.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    pub model: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    /// `host:port` (no scheme). `tls` selects h2 over TLS vs plaintext h2c.
    pub target: String,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub proto_source: ProtoSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metadata: Vec<RequestParameter>,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub order: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// One streaming-call transcript row. `data` is protobuf-JSON (mirrors
/// `WsMessage`); `size` is its byte length.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamMessage {
    pub id: String,
    pub direction: WsDirection,
    pub data: String,
    pub size: u32,
    pub at: String,
}

/// Result of a unary gRPC call. `status_code` is the gRPC status (0 = OK);
/// `message` is the response payload in protobuf-JSON. `metadata`/`trailers`
/// carry response headers and trailers.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcResponse {
    pub request_id: String,
    pub status_code: i32,
    pub status_message: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub metadata: Vec<HttpResponseHeader>,
    #[serde(default)]
    pub trailers: Vec<HttpResponseHeader>,
    pub total_ms: f64,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
    #[serde(default)]
    pub response_id: String,
}

/// A protobuf enum member, for rendering an enum field as a select.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoEnumValue {
    pub name: String,
    pub number: i32,
}

/// The type of a single message field — the discriminant the form renders from.
/// `MessageRef` breaks recursion/depth: the frontend lazily expands it via
/// `grpc_describe_message`. `Map` carries its key/value element types.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtoFieldType {
    /// Protobuf scalar; `name` is the proto type (`string`, `int32`, `bool`, …).
    Scalar {
        name: String,
    },
    Enum {
        name: String,
        values: Vec<ProtoEnumValue>,
    },
    Message {
        schema: Box<ProtoMessageSchema>,
    },
    MessageRef {
        name: String,
    },
    Map {
        key: Box<ProtoFieldType>,
        value: Box<ProtoFieldType>,
    },
}

/// One field of a message, flattened for form rendering. `oneof_group` ties
/// mutually-exclusive fields together; `repeated`/`optional` drive widgets.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFieldSchema {
    pub name: String,
    pub number: i32,
    pub ty: ProtoFieldType,
    pub repeated: bool,
    pub optional: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oneof_group: Option<String>,
}

/// A message's field set — the schema the generated form renders.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMessageSchema {
    pub name: String,
    pub fields: Vec<ProtoFieldSchema>,
}

/// A method's I/O shape: the RPC kind plus the input message schema and the
/// output message's full name (the form only needs to build the request).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMethodInfo {
    pub name: String,
    pub full_name: String,
    pub kind: GrpcRpcKind,
    pub input: ProtoMessageSchema,
    pub output_name: String,
}

/// A service and its methods, returned by `grpc_list_services`.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoServiceInfo {
    pub name: String,
    pub methods: Vec<ProtoMethodInfo>,
}

/// Current UTC time as the millisecond-precision ISO-8601 string used for all
/// `at`/`*_at` fields.
pub fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

pub fn new_id() -> String {
    use rand::RngExt;
    let charset: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut rng = rand::rng();
    (0..8)
        .map(|_| charset[rng.random_range(0..charset.len())])
        .collect()
}

pub fn new_workspace_id() -> String {
    use rand::RngExt;
    let charset: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        .chars()
        .collect();
    let mut rng = rand::rng();
    (0..10)
        .map(|_| charset[rng.random_range(0..charset.len())])
        .collect()
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
