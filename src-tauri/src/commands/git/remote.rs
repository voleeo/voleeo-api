//! Remotes & sync: fetch/pull/push, clone-as-workspace, stored HTTPS
//! credentials, and the committer identity.

use super::{notify, path_of, read_creds, run};
use crate::commands::workspace::register_workspace_folder;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;
use voleeo_core::{
    GitIdentity, GitMergeResult, GitRemoteInfo, GitRepoInfo, VoleeoError, Workspace,
};

#[tauri::command]
#[specta::specta]
pub async fn git_remotes(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitRemoteInfo>, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::remotes(&dir)).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_set_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    url: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::set_remote(&dir, &name, &url)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_set_upstream(
    state: State<'_, AppState>,
    workspace_id: String,
    remote: String,
    branch: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::set_upstream(&dir, &remote, &branch)).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_fetch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitRepoInfo, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let creds = read_creds(&state, &workspace_id).await;
    run(move || voleeo_git::fetch(&dir, creds)).await?;
    notify(&app, workspace_id.clone());
    super::git_repo_info(state, workspace_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_pull(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitMergeResult, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let creds = read_creds(&state, &workspace_id).await;
    let result = run(move || voleeo_git::pull(&dir, creds)).await?;
    notify(&app, workspace_id);
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn git_push(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    let creds = read_creds(&state, &workspace_id).await;
    run(move || voleeo_git::push(&dir, creds)).await?;
    notify(&app, workspace_id);
    Ok(())
}

/// Clone `url` into `dest_parent/<repo-name>` and adopt it as a workspace.
#[tauri::command]
#[specta::specta]
pub async fn git_clone_workspace(
    state: State<'_, AppState>,
    url: String,
    dest_parent: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<Workspace, VoleeoError> {
    let creds = match (username, password) {
        (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => Some((u, p)),
        _ => None,
    };
    // A username/token only works over HTTPS, so switch an SSH URL when given.
    let effective = if creds.is_some() { to_https(&url) } else { url };

    let name = repo_name(&effective);
    let target = PathBuf::from(&dest_parent).join(&name);
    if target.exists() {
        return Err(VoleeoError::InvalidConfig(format!(
            "'{name}' already exists in that folder"
        )));
    }
    let target2 = target.clone();
    let clone = run(move || voleeo_git::clone(&effective, &target2, creds));
    match tokio::time::timeout(std::time::Duration::from_secs(15), clone).await {
        Ok(inner) => inner?,
        Err(_) => {
            return Err(VoleeoError::Git(
                "Clone timed out after 15s — check the repository URL and your connection".into(),
            ))
        }
    }
    register_workspace_folder(&state.app_data_dir, &target)
}

/// Last path segment of a git URL, sans `.git` — the default clone directory.
fn repo_name(url: &str) -> String {
    let last = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("workspace");
    last.trim_end_matches(".git").to_string()
}

/// Convert an SSH-style git URL to HTTPS so a username/token can be used.
/// `git@github.com:user/repo.git` / `ssh://git@github.com/user/repo.git`
/// → `https://github.com/user/repo.git`. Leaves http(s) URLs unchanged.
fn to_https(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        return format!("https://{rest}");
    }
    if let Some(rest) = url.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            return format!("https://{host}/{path}");
        }
    }
    url.to_string()
}

#[tauri::command]
#[specta::specta]
pub async fn git_set_credentials(
    state: State<'_, AppState>,
    workspace_id: String,
    username: String,
    password: String,
) -> Result<(), VoleeoError> {
    let mut s = state.secrets.write().await;
    s.set(format!("git_user:{workspace_id}"), username)?;
    s.set(format!("git_token:{workspace_id}"), password)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_clear_credentials(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    let mut s = state.secrets.write().await;
    s.remove(&format!("git_user:{workspace_id}"))?;
    s.remove(&format!("git_token:{workspace_id}"))?;
    Ok(())
}

/// The stored HTTPS username (never the token), so the settings form can show
/// whether credentials are configured.
#[tauri::command]
#[specta::specta]
pub async fn git_credentials_user(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Option<String>, VoleeoError> {
    let s = state.secrets.read().await;
    Ok(s.get(&format!("git_user:{workspace_id}")).map(String::from))
}

#[tauri::command]
#[specta::specta]
pub async fn git_set_identity(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    email: String,
) -> Result<(), VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::set_identity(&dir, &name, &email)).await?;
    notify(&app, workspace_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_get_identity(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Option<GitIdentity>, VoleeoError> {
    let dir = path_of(&state, &workspace_id);
    run(move || voleeo_git::get_identity(&dir)).await
}
