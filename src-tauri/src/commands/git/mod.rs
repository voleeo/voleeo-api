//! Git sync Tauri commands, split by concern. This module owns the shared
//! infra (blocking-runner, path resolution, change events, credential reads)
//! and re-exports every command so `commands::git::git_*` paths stay stable for
//! `collect_commands!`.

use crate::commands::workspace::resolve_workspace_path;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, State};
use voleeo_core::VoleeoError;

mod branch;
mod conflict;
mod entity;
mod history;
mod remote;
mod repo;

pub use branch::*;
pub use conflict::*;
pub use history::*;
pub use remote::*;
pub use repo::*;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusChanged {
    workspace_id: String,
}

/// Run a blocking git2 closure off the async runtime (CLAUDE.md rule 17).
pub(super) async fn run<T, F>(f: F) -> Result<T, VoleeoError>
where
    F: FnOnce() -> Result<T, VoleeoError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| VoleeoError::Git(format!("git task failed: {e}")))?
}

pub(super) fn path_of(state: &State<'_, AppState>, workspace_id: &str) -> PathBuf {
    // Reject traversal ids: an invalid id resolves to a path inside the
    // workspaces root that cannot exist, so git2 fails to open a repo there
    // rather than operating outside the storage root.
    if voleeo_storage::validate_id(workspace_id).is_err() {
        return state.app_data_dir.join("workspaces").join("__invalid__");
    }
    resolve_workspace_path(&state.app_data_dir, workspace_id)
}

pub(super) fn notify(app: &tauri::AppHandle, workspace_id: String) {
    app.emit("git:status-changed", StatusChanged { workspace_id })
        .ok();
}

/// Stored HTTPS (username, token) for a workspace, used by fetch/pull/push.
pub(super) async fn read_creds(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Option<(String, String)> {
    let s = state.secrets.read().await;
    let user = s.get(&format!("git_user:{workspace_id}"))?.to_string();
    let token = s.get(&format!("git_token:{workspace_id}"))?.to_string();
    Some((user, token))
}
