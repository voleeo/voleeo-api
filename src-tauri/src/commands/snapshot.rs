use tauri::State;
use voleeo_core::{Snapshot, SnapshotReplayResult, VoleeoError};
use voleeo_storage::StoredHttpResponse;

use crate::state::AppState;

/// Promote an existing response into an immutable, git-synced snapshot. The
/// response's `resolved_request` (captured at send time — see
/// `StoredHttpResponse`) is the literal request that produced it; nothing is
/// re-resolved here.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_save(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
    response_id: String,
    name: Option<String>,
) -> Result<Snapshot, VoleeoError> {
    let snapshots = state.snapshots.clone();
    let responses = state.responses.clone();
    let requests = state.requests.clone();
    tokio::task::spawn_blocking(move || {
        snapshots.promote(
            &responses,
            &requests,
            &workspace_id,
            &request_id,
            &response_id,
            name,
        )
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// All snapshot summaries for a workspace in one call — feeds the sidebar tree
/// without shipping bodies over IPC. Full snapshots load lazily via `snapshot_get`.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_list_summaries(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<voleeo_core::SnapshotSummary>, VoleeoError> {
    let snapshots = state.snapshots.clone();
    tokio::task::spawn_blocking(move || snapshots.list_summaries(&workspace_id))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Returns the snapshot with response/request values decrypted for display —
/// auth config secrets stay ciphertext (shown as "encrypted" in the UI).
#[tauri::command]
#[specta::specta]
pub async fn snapshot_get(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
) -> Result<Snapshot, VoleeoError> {
    let snapshots = state.snapshots.clone();
    tokio::task::spawn_blocking(move || {
        let snapshot = snapshots.get(&workspace_id, &snapshot_id)?;
        Ok(snapshots.decrypt_for_display(&workspace_id, snapshot))
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn snapshot_rename(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
    name: String,
) -> Result<Snapshot, VoleeoError> {
    let snapshots = state.snapshots.clone();
    tokio::task::spawn_blocking(move || snapshots.rename(&workspace_id, &snapshot_id, name))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Pin/unpin a snapshot — pinned snapshots sort to the top of their request's list.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_set_pinned(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
    pinned: bool,
) -> Result<Snapshot, VoleeoError> {
    let snapshots = state.snapshots.clone();
    tokio::task::spawn_blocking(move || snapshots.set_pinned(&workspace_id, &snapshot_id, pinned))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Deleting a snapshot is not exposed for MCP (see `crates/voleeo-mcp/src/api/snapshot/`) —
/// destructive ops stay human-only for now.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_delete(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
) -> Result<(), VoleeoError> {
    let snapshots = state.snapshots.clone();
    let responses = state.responses.clone();
    tokio::task::spawn_blocking(move || {
        snapshots.delete(&workspace_id, &snapshot_id)?;
        // Drop the machine-local "latest replay" ring-buffer entry (stored under
        // pseudo id `snapshot_{id}`) so it doesn't outlive the snapshot.
        let _ = responses.clear(&workspace_id, &format!("snapshot_{snapshot_id}"));
        Ok(())
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Re-execute a saved snapshot and report whether the status still matches.
/// Hermetic: static parts replay verbatim, dynamic auth is re-signed from the
/// snapshot's saved (decrypted) config, and the cookies sent are the snapshot's saved
/// `attached_cookies` — never the current jar, and captured cookies don't
/// write back to it. The fresh response overwrites the single machine-local
/// "latest" entry for this snapshot — never git-synced, unlike the snapshot itself.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_replay(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
) -> Result<SnapshotReplayResult, VoleeoError> {
    let snapshots = state.snapshots.clone();
    let (ws, pid) = (workspace_id.clone(), snapshot_id.clone());
    let (snapshot, replay_request, attach_cookies) = tokio::task::spawn_blocking(move || {
        let snapshot = snapshots.get(&ws, &pid)?;
        let (request, cookies) = snapshots.prepare_for_replay(&ws, &snapshot)?;
        Ok::<_, VoleeoError>((snapshot, request, cookies))
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))??;

    let workspaces = state.workspaces.clone();
    let ws_for_dns = workspace_id.clone();
    let dns_overrides = tokio::task::spawn_blocking(move || {
        workspaces
            .get(&ws_for_dns)
            .map(|w| w.dns_overrides)
            .unwrap_or_default()
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?;

    let response = state
        .executor
        .send(&replay_request, attach_cookies, dns_overrides)
        .await?;
    let status_matches = response.status == snapshot.response.status;

    // `responses-local/` ring buffer, reused with limit=1 under a pseudo
    // request id (`snapshot_{id}`) so it can't collide with the parent request's
    // own history and stays outside `workspaces/` (never git-synced) with no
    // new storage module needed.
    let responses = state.responses.clone();
    let pseudo_id = format!("snapshot_{snapshot_id}");
    let (ws, resp_clone, req_clone) = (workspace_id, response.clone(), replay_request);
    let stored = tokio::task::spawn_blocking(move || {
        responses.append(&ws, &pseudo_id, resp_clone, req_clone, 1)
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?;

    let response = match stored {
        Ok(s) => s.response,
        Err(e) => {
            eprintln!("[snapshot] failed to store replay result: {e}");
            response
        }
    };

    Ok(SnapshotReplayResult {
        response,
        status_matches,
    })
}

/// The last replay result for a snapshot, if any — lets the snapshot view restore the
/// verdict/diff after reopening without re-executing.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_get_latest_replay(
    state: State<'_, AppState>,
    workspace_id: String,
    snapshot_id: String,
) -> Result<Option<StoredHttpResponse>, VoleeoError> {
    let responses = state.responses.clone();
    tokio::task::spawn_blocking(move || {
        responses.latest(&workspace_id, &format!("snapshot_{snapshot_id}"))
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}
