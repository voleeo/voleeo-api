//! Thin git2 wrapper for Voleeo workspaces. One repo == one workspace dir.
//!
//! Every public fn is sync/blocking; the Tauri layer wraps calls in
//! `spawn_blocking`. Paths handed in are the RESOLVED workspace dir (symlinks
//! already followed by the command layer). Mutations use `Repository::open`
//! (never `discover`) so a parent repo above a sync folder is never targeted.

mod branch;
mod cred;
mod entity;
mod log;
mod remote;
mod repo;
mod stage;
mod status;
mod sync;

pub mod commit;
pub mod conflict;

pub use branch::{branches, checkout_branch, create_branch, rename_branch};
pub use commit::commit;
pub use conflict::{
    conflict_blobs, conflict_diff_text, finish_merge, heal_merge_worktree, resolve, resolve_delete,
    ConflictBlob,
};
pub use entity::{changed_blobs, commit_blobs, entity_diff_text, revert_commit_files, ChangedBlob};
pub use log::{log, log_for_path};
pub use remote::{remotes, set_remote, set_upstream};
pub use repo::{get_identity, init, repo_info, set_identity};
pub use stage::{discard, stage, stage_all, unstage, unstage_all};
pub use status::{discard_volatile_changes, status};
pub use sync::{clone, fetch, pull, push};

use git2::Repository;
use std::path::Path;
use voleeo_core::{GitNodeKind, VoleeoError};

pub(crate) fn git_err(e: git2::Error) -> VoleeoError {
    VoleeoError::Git(e.message().to_string())
}

pub(crate) fn io_err(e: std::io::Error) -> VoleeoError {
    VoleeoError::Git(e.to_string())
}

pub(crate) fn open_repo(path: &Path) -> Result<Repository, VoleeoError> {
    Repository::open(path).map_err(git_err)
}

/// Map a repo-relative file path to the Voleeo tree node it represents.
/// Files are flat at the repo root (`req_{id}.yaml`, `folder_{id}.yaml`, …).
pub fn classify_path(path: &str) -> (GitNodeKind, Option<String>) {
    let name = path.rsplit('/').next().unwrap_or(path);
    if name == "workspace.yaml" {
        return (GitNodeKind::Workspace, None);
    }
    for (prefix, kind) in [
        ("req_", GitNodeKind::Request),
        ("ws_", GitNodeKind::WebSocket),
        ("grpc_", GitNodeKind::Grpc),
        ("folder_", GitNodeKind::Folder),
        ("jar_", GitNodeKind::Jar),
        ("env_", GitNodeKind::Env),
        ("snapshot_", GitNodeKind::Snapshot),
    ] {
        if let Some(id) = name
            .strip_prefix(prefix)
            .and_then(|s| s.strip_suffix(".yaml"))
        {
            return (kind, Some(id.to_string()));
        }
    }
    (GitNodeKind::Other, None)
}

#[cfg(test)]
mod tests;
