use tauri::{Emitter, State};
use voleeo_core::VoleeoError;

use crate::state::AppState;

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    pub enabled: bool,
    pub token: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get_mcp(state: State<'_, AppState>) -> Result<McpSettings, VoleeoError> {
    let enabled = *state.mcp_enabled.read().await;
    let token = state.mcp_token.read().await.clone();
    Ok(McpSettings { enabled, token })
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set_mcp_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<McpSettings, VoleeoError> {
    *state.mcp_enabled.write().await = enabled;

    // Generate token on first enable if none exists.
    if enabled {
        let has_token = state.mcp_token.read().await.is_some();
        if !has_token {
            let token = generate_token();
            state
                .secrets
                .write()
                .await
                .set("mcp_token".into(), token.clone())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            *state.mcp_token.write().await = Some(token);
        }
    }

    state.save_settings().await;
    // Notify status indicators in every window — they fetch once on mount.
    app.emit("mcp:enabled:changed", McpEnabledChangedEvent { enabled })
        .ok();
    settings_get_mcp(state).await
}

#[derive(serde::Serialize, Clone)]
struct McpEnabledChangedEvent {
    enabled: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get_custom_title_bar(
    state: State<'_, AppState>,
) -> Result<bool, VoleeoError> {
    Ok(*state.custom_title_bar.read().await)
}

// The macOS overlay title bar is set up once at window-open, so applying a change
// means relaunching: persist the choice, then restart so the new chrome takes hold.
#[tauri::command]
#[specta::specta]
pub async fn settings_set_custom_title_bar(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), VoleeoError> {
    *state.custom_title_bar.write().await = enabled;
    state.save_settings().await;
    app.restart();
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get_auto_update(state: State<'_, AppState>) -> Result<bool, VoleeoError> {
    Ok(*state.auto_update.read().await)
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set_auto_update(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), VoleeoError> {
    *state.auto_update.write().await = enabled;
    state.save_settings().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reposition_window_controls(window: tauri::Window) -> Result<(), VoleeoError> {
    #[cfg(target_os = "macos")]
    voleeo_mac_window::reposition_traffic_lights(&window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_workspace_menu_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), VoleeoError> {
    #[cfg(target_os = "macos")]
    crate::menu::set_workspace_items_enabled(&app, enabled);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, enabled);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_regenerate_mcp_token(
    state: State<'_, AppState>,
) -> Result<String, VoleeoError> {
    let token = generate_token();
    state
        .secrets
        .write()
        .await
        .set("mcp_token".into(), token.clone())
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    *state.mcp_token.write().await = Some(token.clone());
    Ok(token)
}

fn generate_token() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    (0..32)
        .map(|_| format!("{:02x}", rng.random::<u8>()))
        .collect()
}
