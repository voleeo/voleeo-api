//! Export a set of Voleeo workspaces. Two targets:
//! - **Voleeo Bundle** (`to_voleeo`): one self-contained, lossless YAML of the
//!   native core types — re-importable into Voleeo with full fidelity.
//! - **Postman Collection v2.1** (`to_postman`): a portable HTTP collection, with
//!   gRPC/WebSocket emitted as companion `.proto`/AsyncAPI files by the caller.
//!
//! Pure — no Tauri, storage, or crypto. The command layer decrypts secrets and
//! assembles the bundles; here values are already plaintext. We map **core types
//! directly**, never through `voleeo-import`'s IR (which is lossy on auth and
//! drops WS/gRPC).

mod asyncapi;
mod auth;
mod postman;
mod voleeo;

use voleeo_core::{ApiFolder, Environment, GrpcRequest, HttpRequest, Workspace, WsConnection};

pub use asyncapi::to_asyncapi;
pub use postman::{postman_environments, to_postman};
pub use voleeo::to_voleeo;

/// A file the caller should write under a derived name (the command layer slugs
/// `name` into the final filename). Used for Postman environment exports.
pub struct NamedFile {
    pub name: String,
    pub content: String,
}

/// One workspace's fully-loaded, already-decrypted contents.
pub struct Bundle {
    pub workspace: Workspace,
    pub folders: Vec<ApiFolder>,
    pub requests: Vec<HttpRequest>,
    pub ws: Vec<WsConnection>,
    pub grpc: Vec<GrpcRequest>,
    pub environments: Vec<Environment>,
}

/// Serialized output plus any non-fatal warnings (skipped/lossy items).
pub struct ExportResult {
    pub content: String,
    pub warnings: Vec<String>,
}

/// A node under one folder scope, kept in `order` so siblings interleave the way
/// the user arranged them. Only folders + HTTP requests form the collection tree;
/// gRPC/WS are exported to their own formats straight off the `Bundle`.
pub(crate) enum Node<'a> {
    Folder(&'a ApiFolder),
    Http(&'a HttpRequest),
}

/// Direct children of `parent` (`None` = workspace root), sorted by `order`.
pub(crate) fn children<'a>(b: &'a Bundle, parent: Option<&str>) -> Vec<Node<'a>> {
    let mut out: Vec<(f64, Node<'a>)> = Vec::new();
    for f in &b.folders {
        if f.folder_id.as_deref() == parent {
            out.push((f.order, Node::Folder(f)));
        }
    }
    for r in &b.requests {
        if r.folder_id.as_deref() == parent {
            out.push((r.order, Node::Http(r)));
        }
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    out.into_iter().map(|(_, n)| n).collect()
}
