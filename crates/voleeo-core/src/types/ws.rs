//! WebSocket connection and transcript types.

use super::common::RequestParameter;
use crate::auth::AuthConfig;
use serde::{Deserialize, Serialize};
use specta::Type;

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
