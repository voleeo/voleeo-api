//! Workspace, environment, and shared request primitives, plus id/time helpers.

use crate::auth::{is_auth_none, AuthConfig};
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

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestParameter {
    pub id: String,
    pub name: String,
    pub value: String,
    pub enabled: bool,
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
