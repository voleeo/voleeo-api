//! The **Voleeo Bundle** — a self-contained, lossless YAML snapshot of one or more
//! workspaces. Exported by `voleeo-export` and re-imported by the desktop app.
//!
//! Unlike the import IR (which normalizes foreign formats and drops WS/gRPC plus
//! exotic auth), this is the native core types serialized verbatim, so a
//! round-trip preserves everything: HTTP/WebSocket/gRPC requests, folders,
//! environments, workspace auth/headers/DNS, and every auth scheme.
//!
//! See `/docs/voleeo-bundle-v1.md` for the public format documentation.

use serde::{Deserialize, Serialize};

use crate::{ApiFolder, Environment, GrpcRequest, HttpRequest, Workspace, WsConnection};

/// Current bundle version. Also the unique root key (`voleeoBundle`) used to detect
/// the format on import.
pub const VOLEEO_BUNDLE_VERSION: &str = "1.0";

/// Top-level Voleeo Bundle document.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoleeoBundle {
    /// Format version, e.g. `"1.0"`. Doubles as the detection key.
    pub voleeo_bundle: String,
    pub workspaces: Vec<VoleeoWorkspace>,
}

/// One workspace and all of its contents.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoleeoWorkspace {
    pub workspace: Workspace,
    #[serde(default)]
    pub folders: Vec<ApiFolder>,
    #[serde(default)]
    pub requests: Vec<HttpRequest>,
    #[serde(default)]
    pub websockets: Vec<WsConnection>,
    #[serde(default)]
    pub grpc: Vec<GrpcRequest>,
    #[serde(default)]
    pub environments: Vec<Environment>,
}
