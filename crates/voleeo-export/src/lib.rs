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

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use voleeo_core::{ApiFolder, Environment, GrpcRequest, HttpRequest, Workspace, WsConnection};

pub use asyncapi::to_asyncapi;
pub use postman::{postman_environments, to_postman, to_postman_with_roots};
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

impl Bundle {
    /// Keep selected folder subtrees plus ancestor metadata needed for inheritance.
    /// Returns `false` when any selected folder is not part of the workspace.
    pub fn filter_to_folders(&mut self, folder_ids: &[&str]) -> bool {
        if folder_ids.is_empty() {
            return true;
        }

        let parents_by_id: HashMap<&str, Option<&str>> = self
            .folders
            .iter()
            .map(|folder| (folder.id.as_str(), folder.folder_id.as_deref()))
            .collect();
        if folder_ids.iter().any(|id| !parents_by_id.contains_key(id)) {
            return false;
        }

        let mut children_by_parent: HashMap<&str, Vec<&str>> = HashMap::new();
        for folder in &self.folders {
            if let Some(parent) = folder.folder_id.as_deref() {
                children_by_parent
                    .entry(parent)
                    .or_default()
                    .push(folder.id.as_str());
            }
        }

        let mut included: HashSet<String> = folder_ids.iter().map(|id| (*id).to_string()).collect();
        let mut pending = folder_ids.to_vec();
        while let Some(parent) = pending.pop() {
            for &child in children_by_parent.get(parent).into_iter().flatten() {
                if included.insert(child.to_string()) {
                    pending.push(child);
                }
            }
        }

        let mut folders_to_keep = included.clone();
        for root_id in folder_ids {
            let mut parent = parents_by_id.get(root_id).copied().flatten();
            let mut seen = HashSet::new();
            while let Some(parent_id) = parent {
                if !seen.insert(parent_id) {
                    break;
                }
                folders_to_keep.insert(parent_id.to_string());
                parent = parents_by_id.get(parent_id).copied().flatten();
            }
        }

        self.folders.retain(|f| folders_to_keep.contains(&f.id));
        self.requests.retain(|r| {
            r.folder_id
                .as_deref()
                .is_some_and(|id| included.contains(id))
        });
        self.ws.retain(|w| {
            w.folder_id
                .as_deref()
                .is_some_and(|id| included.contains(id))
        });
        self.grpc.retain(|g| {
            g.folder_id
                .as_deref()
                .is_some_and(|id| included.contains(id))
        });
        true
    }
}

/// Remove whitespace around template expressions for consumers that require the
/// compact `{{name}}` form. Function arguments inside the expression are kept.
pub(crate) fn normalize_templates(input: &str) -> Cow<'_, str> {
    if !input.contains("{{") {
        return Cow::Borrowed(input);
    }

    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let expression = &rest[start + 2..];
        let Some(end) = expression.find("}}") else {
            out.push_str(&rest[start..]);
            return Cow::Owned(out);
        };
        out.push_str("{{");
        out.push_str(expression[..end].trim());
        out.push_str("}}");
        rest = &expression[end + 2..];
    }
    out.push_str(rest);
    Cow::Owned(out)
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
