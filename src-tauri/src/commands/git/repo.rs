//! Local repo state: info, init, status, the pending-changes review, staging, and commit.

use super::entity::blobs_to_changes;
use super::{notify, path_of, run};
use crate::commands::request::Stores;
use crate::commands::workspace::ensure_gitignore;
use crate::state::AppState;
use tauri::State;
use voleeo_core::{AuthConfig, GitCommit, GitEntityChange, GitRepoInfo, GitStatus, VoleeoError};

#[tauri::command]
#[specta::specta]
pub async fn git_repo_info(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitRepoInfo, VoleeoError> {
    let path = path_of(&state, &workspace_id);
    let mut info = run(move || voleeo_git::repo_info(&path)).await?;
    if let Ok(ws) = state.workspaces.get(&workspace_id) {
        info.encrypted = ws.encrypted;
        if !ws.encrypted {
            info.unencrypted_secrets =
                has_plaintext_secrets(&state, &workspace_id).unwrap_or(false);
        }
    }
    Ok(info)
}

#[tauri::command]
#[specta::specta]
pub async fn git_init(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitRepoInfo, VoleeoError> {
    let path = path_of(&state, &workspace_id);
    run(move || {
        voleeo_git::init(&path)?;
        ensure_gitignore(&path)
    })
    .await?;
    notify(&app, workspace_id.clone());
    git_repo_info(state, workspace_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_status(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitStatus, VoleeoError> {
    let path = path_of(&state, &workspace_id);
    run(move || {
        // Editing then undoing an entity still rewrites its `updatedAt`, leaving a
        // timestamp-only diff that the UI hides but raw `git` (and any push) would
        // surface. Revert those on disk before reporting so the worktree matches
        // what the user actually sees.
        voleeo_git::discard_volatile_changes(&path)?;
        voleeo_git::status(&path)
    })
    .await
}

/// All pending changes as decrypted entity snapshots (HEAD `old` vs working
/// `new`). The frontend turns these into the friendly field-level review.
#[tauri::command]
#[specta::specta]
pub async fn git_changes(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitEntityChange>, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let blobs = run(move || voleeo_git::changed_blobs(&dir)).await?;
    blobs_to_changes(blobs, &workspace_id, &Stores::from(&state))
}

#[tauri::command]
#[specta::specta]
pub async fn git_entity_diff(
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> Result<String, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::entity_diff_text(&dir, &path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_stage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::stage(&dir, &paths)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_stage_all(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::stage_all(&dir)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_unstage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::unstage(&dir, &paths)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_unstage_all(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::unstage_all(&dir)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_discard(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::discard(&dir, &paths)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_commit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
) -> Result<GitCommit, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let author = match (author_name, author_email) {
        (Some(n), Some(e)) => Some((n, e)),
        _ => None,
    };
    let commit = run(move || voleeo_git::commit(&dir, &message, author)).await?;
    notify(&app, workspace_id);
    Ok(commit)
}

/// True when an unencrypted workspace defines any auth secret that would land in
/// the repo as plaintext — drives the "encrypt first" warning at init.
fn has_plaintext_secrets(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<bool, VoleeoError> {
    let ws = state.workspaces.get(workspace_id)?;
    if auth_has_secret(&ws.auth) {
        return Ok(true);
    }
    if state
        .requests
        .list_requests(workspace_id)?
        .iter()
        .any(|r| auth_has_secret(&r.auth))
    {
        return Ok(true);
    }
    if state
        .requests
        .list_folders(workspace_id)?
        .iter()
        .any(|f| auth_has_secret(&f.auth))
    {
        return Ok(true);
    }
    Ok(false)
}

fn auth_has_secret(a: &AuthConfig) -> bool {
    matches!(
        a,
        AuthConfig::Bearer { .. } | AuthConfig::Basic { .. } | AuthConfig::ApiKey { .. }
    )
}
