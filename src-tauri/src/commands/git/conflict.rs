//! Conflict resolution: load the three sides of each conflict, write back a
//! user-merged entity, accept a deletion, and finish the merge.

use super::entity::{encrypt_entity, entity_to_yaml, parse_entity};
use super::{notify, path_of, run};
use crate::commands::request::Stores;
use crate::state::AppState;
use tauri::State;
use voleeo_core::{GitCommit, GitEntity, GitEntityConflict, GitNodeKind, VoleeoError};

/// Each conflicted entity's three sides, decrypted, for the friendly chooser.
#[tauri::command]
#[specta::specta]
pub async fn git_entity_conflicts(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitEntityConflict>, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let blobs = run(move || voleeo_git::conflict_blobs(&dir)).await?;
    let stores = Stores::from(&state);
    let mut out = Vec::new();
    for b in blobs {
        if matches!(b.node_kind, GitNodeKind::Other) {
            continue;
        }
        out.push(GitEntityConflict {
            base: parse_entity(b.node_kind, b.base.as_deref(), &workspace_id, &stores)?,
            ours: parse_entity(b.node_kind, b.ours.as_deref(), &workspace_id, &stores)?,
            theirs: parse_entity(b.node_kind, b.theirs.as_deref(), &workspace_id, &stores)?,
            path: b.path,
            node_id: b.node_id,
            node_kind: b.node_kind,
        });
    }
    Ok(out)
}

/// Write a user-merged entity back to its file (re-encrypting at rest when the
/// workspace is encrypted). Conflicted paths are staged, clearing the conflict;
/// non-conflict callers (the per-field revert) only touch the worktree.
#[tauri::command]
#[specta::specta]
pub async fn git_resolve_entity(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
    mut entity: GitEntity,
) -> Result<(), VoleeoError> {
    encrypt_entity(&mut entity, &workspace_id, &Stores::from(&state))?;
    let yaml = entity_to_yaml(&entity)?;
    let dir = path_of(&state, &workspace_id);
    let file = path.clone();
    run(move || voleeo_git::resolve(&dir, &file, &yaml)).await?;
    notify(&app, workspace_id);
    Ok(())
}

/// Resolve a delete/modify conflict by accepting the deletion — the user chose
/// the side that removed the entity.
#[tauri::command]
#[specta::specta]
pub async fn git_resolve_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::resolve_delete(&dir, &path)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_finish_merge(
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
    let commit = run(move || voleeo_git::finish_merge(&dir, &message, author)).await?;
    notify(&app, workspace_id);
    Ok(commit)
}
