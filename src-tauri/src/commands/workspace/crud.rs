use super::derive_sync_dir;
use crate::commands::request::{run_blocking, transform_auth_secrets, Direction, Stores};
use crate::state::AppState;
use std::path::Path;
use tauri::State;
use voleeo_core::{AuthConfig, RequestParameter, VoleeoError, Workspace};
use voleeo_crypto as workspace_key;

/// Restore the local side of any on-disk workspace that didn't parse — usually a
/// mid-merge `workspace.yaml` full of conflict markers (the conflict stays in the
/// index + MERGE_HEAD for the resolver). Returns whether anything was healed.
fn heal_unfinished_merges(app_data_dir: &Path, parsed: &[Workspace]) -> bool {
    let parsed_ids: std::collections::HashSet<&str> =
        parsed.iter().map(|w| w.id.as_str()).collect();
    let Ok(entries) = std::fs::read_dir(app_data_dir.join("workspaces")) else {
        return false;
    };
    let mut healed = false;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.join("workspace.yaml").exists() {
            continue;
        }
        // The folder name is the workspace id; if it parsed it's healthy — skip.
        let is_healthy = dir
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| parsed_ids.contains(name));
        if is_healthy {
            continue;
        }
        if matches!(voleeo_git::heal_merge_worktree(&dir), Ok(true)) {
            healed = true;
        }
    }
    healed
}

#[tauri::command]
#[specta::specta]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, VoleeoError> {
    let stores = Stores::from(&state);
    let app_data_dir = state.app_data_dir.clone();
    // read_dir + git2 heal + YAML reads all block; keep them off the runtime.
    run_blocking(move || {
        let mut workspaces = stores.workspaces.list()?;
        // Recover any workspace hidden by an unfinished merge, then re-list.
        if heal_unfinished_merges(&app_data_dir, &workspaces) {
            workspaces = stores.workspaces.list()?;
        }
        for ws in &mut workspaces {
            // sync_dir is derived from the symlink, not stored in YAML.
            ws.sync_dir = derive_sync_dir(&app_data_dir, &ws.id);
            // Auth secrets travel plaintext over IPC; ciphertext on disk.
            let id = ws.id.clone();
            transform_auth_secrets(&mut ws.auth, &id, &stores, Direction::Decrypt)?;
        }
        Ok(workspaces)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_workspace_headers(
    state: State<'_, AppState>,
    workspace_id: String,
    headers: Vec<RequestParameter>,
) -> Result<(), VoleeoError> {
    let workspaces = state.workspaces.clone();
    run_blocking(move || workspaces.update_headers(&workspace_id, headers)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_workspace_auth(
    state: State<'_, AppState>,
    workspace_id: String,
    mut auth: AuthConfig,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        transform_auth_secrets(&mut auth, &workspace_id, &stores, Direction::Encrypt)?;
        stores.workspaces.update_auth(&workspace_id, auth)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_workspace_dns_overrides(
    state: State<'_, AppState>,
    workspace_id: String,
    overrides: Vec<voleeo_core::DnsOverride>,
) -> Result<(), VoleeoError> {
    let workspaces = state.workspaces.clone();
    run_blocking(move || workspaces.update_dns_overrides(&workspace_id, overrides)).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
    encrypted: Option<bool>,
) -> Result<Workspace, VoleeoError> {
    let enc = encrypted.unwrap_or(false);
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    // create() writes YAML; save_key touches the OS keychain — both block.
    run_blocking(move || {
        let ws = workspaces.create(name, enc)?;
        if enc {
            let key = workspace_key::generate_key();
            workspace_key::save_key(&ws.id, &key, &app_data_dir)?;
        }
        Ok(ws)
    })
    .await
}

/// Permanently delete a workspace and its encryption key (if any).
#[tauri::command]
#[specta::specta]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    // These commands build `workspaces/{id}` paths directly and remove_dir_all
    // them, bypassing the storage layer's own id validation — guard here so a
    // traversal id can't escape the workspaces root.
    voleeo_storage::validate_id(&workspace_id)?;
    let workspaces = state.workspaces.clone();
    let environments = state.environments.clone();
    let selections = state.selections.clone();
    let secrets = state.secrets.clone();
    let app_data_dir = state.app_data_dir.clone();
    // remove_dir_all, keychain delete, and YAML cleanup all block; the secrets
    // guard is taken via blocking_write so it never crosses an .await.
    run_blocking(move || {
        // When synced, workspaces/{id} is a symlink to a custom folder.
        // storage.delete() can't recurse a symlink — it would orphan the files
        // in the sync dir. Delete the real folder, then drop the symlink.
        let internal_dir = app_data_dir.join("workspaces").join(&workspace_id);
        if internal_dir.is_symlink() {
            if let Ok(target) = crate::platform::read_link_target(&internal_dir) {
                if let Err(e) = std::fs::remove_dir_all(&target) {
                    eprintln!("[workspace] failed to delete sync folder {target:?}: {e}");
                }
            }
            crate::platform::remove_link(&internal_dir)
                .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
        } else {
            workspaces.delete(&workspace_id)?;
        }
        // Best-effort cleanup of secrets, encryption key, and machine-local env files.
        let _ = secrets.blocking_write().remove(&workspace_id);
        workspace_key::delete_key(&workspace_id, &app_data_dir);
        let _ = environments.delete_workspace(&workspace_id);
        let _ = selections.delete_workspace(&workspace_id);
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<Workspace, VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let mut ws = workspaces.get(&workspace_id)?;
        ws.name = name;
        ws.updated_at = chrono::Utc::now().to_rfc3339();
        workspaces.save(&ws)?;
        // Re-attach sync dir (YAML never stores it; we derive it from symlink).
        ws.sync_dir = derive_sync_dir(&app_data_dir, &workspace_id);
        Ok(ws)
    })
    .await
}
