//! Per-workspace UI/local settings (stored in
//! `{app_data_dir}/workspace-settings.yaml`).

use crate::state::AppState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;
use voleeo_core::VoleeoError;

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
    /// OS env var names exposed to `{{ }}` resolution (lowest precedence).
    /// Machine-local by design — also read leniently by
    /// `voleeo_mcp::resolve::system_env` at send time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_env_allowlist: Option<Vec<String>>,
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
