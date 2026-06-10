use crate::commands::request::{run_blocking, transform_auth_secrets, Direction, Stores};
use crate::state::AppState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

/// Sync dir = the symlink target when `workspaces/{id}` is a symlink, else
/// `None` (normal internal storage).
fn derive_sync_dir(app_data_dir: &Path, workspace_id: &str) -> Option<String> {
    let internal = app_data_dir.join("workspaces").join(workspace_id);
    if internal.is_symlink() {
        std::fs::read_link(&internal)
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Resolved on-disk dir of a workspace: the symlink target when synced, else the
/// internal app-data path. Shared by `workspace_get_path` and the git commands.
pub(crate) fn resolve_workspace_path(app_data_dir: &Path, workspace_id: &str) -> PathBuf {
    let internal = app_data_dir.join("workspaces").join(workspace_id);
    if internal.is_symlink() {
        std::fs::read_link(&internal).unwrap_or(internal)
    } else {
        internal
    }
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

/// Returns the 8×8 hex backup key for display to the user.
/// Only valid when `workspace.encrypted == true`.
#[tauri::command]
#[specta::specta]
pub async fn workspace_get_key_display(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        Ok(workspace_key::encode_key_display(&key))
    })
    .await
}

/// Enable encryption on an existing workspace: generate + store a key,
/// re-encrypt any existing plaintext secret, persist `encrypted = true` + a
/// key-check token, and return the display key for the backup card.
#[tauri::command]
#[specta::specta]
pub async fn workspace_enable_encryption(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    let secrets = state.secrets.clone();
    // Keychain save, secret re-encrypt+persist, and YAML save all block; the
    // secrets guard is taken via blocking_write so it never crosses an .await.
    run_blocking(move || {
        let key = workspace_key::generate_key();
        workspace_key::save_key(&workspace_id, &key, &app_data_dir)?;

        // Re-encrypt any existing plaintext secret for this workspace.
        {
            let mut secrets = secrets.blocking_write();
            if let Some(plain) = secrets.get(&workspace_id).map(|s| s.to_owned()) {
                if !workspace_key::is_encrypted(&plain) {
                    secrets.set_encrypted(workspace_id.clone(), &plain, &key)?;
                }
            }
        }

        // Persist workspace.encrypted = true + a key-verification token.
        let key_check = workspace_key::encrypt(&workspace_id, &key)?;
        let mut ws = workspaces.get(&workspace_id)?;
        ws.encrypted = true;
        ws.key_check = Some(key_check);
        workspaces.save(&ws)?;

        Ok(workspace_key::encode_key_display(&key))
    })
    .await
}

/// Import a backup key, replacing the current one. When the workspace has a
/// `keyCheck` token, decrypt it with the candidate and verify it matches the
/// workspace ID — catches typos before they lock the user out of their secrets.
#[tauri::command]
#[specta::specta]
pub async fn workspace_import_key(
    state: State<'_, AppState>,
    workspace_id: String,
    display_key: String,
) -> Result<(), VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    // YAML read + keychain save both block.
    run_blocking(move || {
        let key = workspace_key::decode_key_display(&display_key)?;

        // Verify the key is correct when we have a token to check against.
        if let Ok(ws) = workspaces.get(&workspace_id) {
            if let Some(token) = &ws.key_check {
                let plaintext = workspace_key::decrypt(token, &key).map_err(|_| {
                    VoleeoError::Crypto(
                        "This key does not match the one used to encrypt this workspace. \
                         Please check that you're importing the correct backup key."
                            .to_string(),
                    )
                })?;
                if plaintext != workspace_id {
                    return Err(VoleeoError::Crypto(
                        "Key verification failed — the decrypted token did not match \
                         this workspace. Please import the correct backup key."
                            .to_string(),
                    ));
                }
            }
        }

        workspace_key::save_key(&workspace_id, &key, &app_data_dir)?;
        Ok(())
    })
    .await
}

/// Encrypt a value with the workspace key → `enc:v1:…`. Backs the
/// `{{ encrypt(value) }}` template function. Requires encryption enabled.
#[tauri::command]
#[specta::specta]
pub async fn workspace_encrypt_value(
    state: State<'_, AppState>,
    workspace_id: String,
    plaintext: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        workspace_key::encrypt(&plaintext, &key)
    })
    .await
}

/// Decrypt a ciphertext produced by `workspace_encrypt_value` back to plaintext.
/// The workspace must have encryption enabled and a key available.
#[tauri::command]
#[specta::specta]
pub async fn workspace_decrypt_value(
    state: State<'_, AppState>,
    workspace_id: String,
    ciphertext: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        workspace_key::decrypt(&ciphertext, &key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_has_key(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<bool, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || Ok(workspace_key::load_key(&workspace_id, &app_data_dir).is_ok())).await
}

/// Permanently delete a workspace and its encryption key (if any).
#[tauri::command]
#[specta::specta]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), VoleeoError> {
    let workspaces = state.workspaces.clone();
    let environments = state.environments.clone();
    let selections = state.selections.clone();
    let secrets = state.secrets.clone();
    let app_data_dir = state.app_data_dir.clone();
    // remove_dir_all, keychain delete, and YAML cleanup all block; the secrets
    // guard is taken via blocking_write so it never crosses an .await.
    run_blocking(move || {
        workspaces.delete(&workspace_id)?;
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

/// Absolute path of the workspace's data dir — the symlink target when synced,
/// else the internal app-data path.
#[tauri::command]
#[specta::specta]
pub async fn workspace_get_path(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    Ok(resolve_workspace_path(&state.app_data_dir, &workspace_id)
        .to_string_lossy()
        .into_owned())
}

/// Set (or clear) a workspace's sync directory. Setting one copies the files to
/// the chosen folder and replaces the internal dir with a symlink, so every
/// later write lands in the sync dir transparently.
#[tauri::command]
#[specta::specta]
pub async fn workspace_set_sync_dir(
    state: State<'_, AppState>,
    workspace_id: String,
    sync_dir: Option<String>,
) -> Result<Workspace, VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    // Symlink + recursive copy + remove_dir_all all block; keep off the runtime.
    run_blocking(move || {
        let internal_dir = app_data_dir.join("workspaces").join(&workspace_id);

        match &sync_dir {
            Some(new_dir_str) => {
                let new_dir = PathBuf::from(new_dir_str);

                // Copy from the current target if already symlinked, else internal_dir.
                let copy_src = if internal_dir.is_symlink() {
                    std::fs::read_link(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?
                } else {
                    internal_dir.clone()
                };

                copy_workspace_files(&copy_src, &new_dir)?;
                ensure_gitignore(&new_dir)?;

                // Remove the old internal_dir entry (real dir or previous symlink).
                if internal_dir.is_symlink() {
                    std::fs::remove_file(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
                } else {
                    std::fs::remove_dir_all(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove dir: {e}")))?;
                }

                // Symlink internal_dir → new_dir; all stores read/write through it.
                #[cfg(unix)]
                std::os::unix::fs::symlink(&new_dir, &internal_dir)
                    .map_err(|e| VoleeoError::Storage(format!("create symlink: {e}")))?;

                #[cfg(not(unix))]
                return Err(VoleeoError::InvalidConfig(
                    "Directory sync requires a Unix system (macOS / Linux)".to_string(),
                ));
            }
            None => {
                // Undo only if a symlink exists: restore a real dir, copy files back.
                if internal_dir.is_symlink() {
                    let target = std::fs::read_link(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?;

                    std::fs::remove_file(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
                    std::fs::create_dir_all(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("create dir: {e}")))?;
                    copy_workspace_files(&target, &internal_dir)?;
                }
            }
        }

        // sync_dir is machine-local — never persist it; the symlink is the source
        // of truth (re-derived below).
        let mut ws = workspaces.get(&workspace_id)?;
        ws.sync_dir = None; // ensure it never lands in YAML
        ws.updated_at = chrono::Utc::now().to_rfc3339();
        workspaces.save(&ws)?;

        // Re-attach sync dir from the symlink for the UI response.
        ws.sync_dir = derive_sync_dir(&app_data_dir, &workspace_id);
        Ok(ws)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_open_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Workspace, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    // read_to_string + git2 heal + symlink ops all block; keep off the runtime.
    run_blocking(move || register_workspace_folder(&app_data_dir, &PathBuf::from(&folder_path)))
        .await
}

/// Adopt a folder containing a `workspace.yaml` as a workspace: parse it and
/// symlink `workspaces/{id}` → the folder. Shared by Open Folder and Clone.
pub(crate) fn register_workspace_folder(
    app_data_dir: &Path,
    folder: &Path,
) -> Result<Workspace, VoleeoError> {
    let yaml_path = folder.join("workspace.yaml");
    if !yaml_path.exists() {
        return Err(VoleeoError::InvalidConfig(
            "This folder is not a Voleeo workspace (no workspace.yaml)".to_string(),
        ));
    }

    // Recover a mid-merge folder so its workspace.yaml parses (see heal above).
    let _ = voleeo_git::heal_merge_worktree(folder);

    let content = std::fs::read_to_string(&yaml_path)
        .map_err(|e| VoleeoError::Storage(format!("read workspace.yaml: {e}")))?;

    let ws: Workspace = serde_yaml::from_str(&content).map_err(|_| {
        VoleeoError::InvalidConfig(
            "workspace.yaml exists but could not be parsed as a Voleeo workspace.".to_string(),
        )
    })?;

    let internal_dir = app_data_dir.join("workspaces").join(&ws.id);

    if internal_dir.is_symlink() {
        let current_target = std::fs::read_link(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?;
        if current_target == folder {
            return Ok(ws);
        }
        std::fs::remove_file(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
    } else if internal_dir.exists() {
        std::fs::remove_dir_all(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("remove dir: {e}")))?;
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(folder, &internal_dir)
        .map_err(|e| VoleeoError::Storage(format!("create symlink: {e}")))?;

    #[cfg(not(unix))]
    return Err(VoleeoError::InvalidConfig(
        "Open Folder requires a Unix system (macOS / Linux)".to_string(),
    ));

    Ok(ws)
}

/// Ensure `dir/.gitignore` contains the managed entries (currently `.DS_Store`).
pub(crate) fn ensure_gitignore(dir: &Path) -> Result<(), VoleeoError> {
    const ENTRIES: &[&str] = &[".DS_Store"];

    let path = dir.join(".gitignore");

    let existing = if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| VoleeoError::Storage(format!("read .gitignore: {e}")))?
    } else {
        String::new()
    };

    let missing: Vec<&str> = ENTRIES
        .iter()
        .filter(|&&e| !existing.lines().any(|l| l.trim() == e))
        .copied()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };

    let header = if existing.is_empty() {
        "# Voleeo — machine-local files, do not commit\n"
    } else {
        ""
    };

    let append = format!("{separator}{header}{}\n", missing.join("\n"));

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| VoleeoError::Storage(format!("open .gitignore: {e}")))?;

    std::io::Write::write_all(&mut file, append.as_bytes())
        .map_err(|e| VoleeoError::Storage(format!("write .gitignore: {e}")))?;

    Ok(())
}

// ── Per-workspace settings (stored in {app_data_dir}/workspace-settings.yaml) ─

/// Panel-size percentages for the API workspace layout.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PanelSizes {
    pub col_pane1: f64,
    pub col_pane3: f64,
    pub row_tree: f64,
    pub row_inner: f64,
}

/// Saved window dimensions (logical pixels).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

/// All UI/local settings for a single workspace.
/// Extend this struct as new per-workspace settings are added.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_sizes: Option<PanelSizes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opened_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_size: Option<WindowSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_env_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_visible: Option<bool>,
}

/// One entry in the YAML list — carries the id key so we can look up by workspace.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSettingsEntry {
    id: String,
    #[serde(flatten)]
    settings: WorkspaceSettings,
}

/// Root of `workspace-settings.yaml`.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct WorkspaceSettingsFile {
    #[serde(default)]
    workspaces: Vec<WorkspaceSettingsEntry>,
}

fn ws_settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("workspace-settings.yaml")
}

fn read_ws_settings_file(path: &Path) -> WorkspaceSettingsFile {
    if !path.exists() {
        return WorkspaceSettingsFile::default();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_yaml::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_ws_settings_file(path: &Path, file: &WorkspaceSettingsFile) -> Result<(), VoleeoError> {
    let content = serde_yaml::to_string(file).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_get_settings(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceSettings, VoleeoError> {
    let path = ws_settings_path(&state.app_data_dir);
    tokio::task::spawn_blocking(move || {
        let file = read_ws_settings_file(&path);
        Ok(file
            .workspaces
            .into_iter()
            .find(|e| e.id == workspace_id)
            .map(|e| e.settings)
            .unwrap_or_default())
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_list_settings(
    state: State<'_, AppState>,
) -> Result<HashMap<String, WorkspaceSettings>, VoleeoError> {
    let path = ws_settings_path(&state.app_data_dir);
    tokio::task::spawn_blocking(move || {
        let file = read_ws_settings_file(&path);
        Ok(file
            .workspaces
            .into_iter()
            .map(|e| (e.id, e.settings))
            .collect())
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_save_settings(
    state: State<'_, AppState>,
    workspace_id: String,
    settings: WorkspaceSettings,
) -> Result<(), VoleeoError> {
    let path = ws_settings_path(&state.app_data_dir);
    // blocking_lock inside spawn_blocking serialises read-modify-write cycles
    // without holding a guard across .await (CLAUDE.md rule 19).
    let lock = state.ws_settings_lock.clone();
    tokio::task::spawn_blocking(move || {
        let _guard = lock.blocking_lock();
        let mut file = read_ws_settings_file(&path);
        match file.workspaces.iter_mut().find(|e| e.id == workspace_id) {
            Some(entry) => entry.settings = settings,
            None => file.workspaces.push(WorkspaceSettingsEntry {
                id: workspace_id,
                settings,
            }),
        }
        write_ws_settings_file(&path, &file)
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

fn copy_workspace_files(src: &Path, dst: &Path) -> Result<(), VoleeoError> {
    std::fs::create_dir_all(dst)
        .map_err(|e| VoleeoError::Storage(format!("cannot create dir {dst:?}: {e}")))?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| VoleeoError::Storage(format!("cannot read dir {src:?}: {e}")))?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let dst_path = dst.join(entry.file_name());
        std::fs::copy(entry.path(), &dst_path)
            .map_err(|e| VoleeoError::Storage(format!("copy {:?}: {e}", entry.file_name())))?;
    }

    Ok(())
}
