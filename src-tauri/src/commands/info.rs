use serde::Serialize;
use specta::Type;
use tauri::Manager;
use voleeo_core::VoleeoError;

#[derive(Serialize, Type)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub log_dir: String,
    pub bridge_path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_app_info(app: tauri::AppHandle) -> Result<AppInfo, VoleeoError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;

    // EXE_SUFFIX is ".exe" on Windows, "" elsewhere — the sidecar is bundled
    // next to the main executable as voleeo-mcp-bridge[.exe].
    let bridge_name = format!("voleeo-mcp-bridge{}", std::env::consts::EXE_SUFFIX);
    let bridge_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(&bridge_name)))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(bridge_name);

    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
        log_dir: log_dir.to_string_lossy().to_string(),
        bridge_path,
    })
}

/// Toggle the main window's native menu bar (Windows auto-hide menu, revealed
/// with Alt). No-op off Windows.
#[tauri::command]
#[specta::specta]
pub async fn toggle_main_menu(app: tauri::AppHandle) -> Result<(), VoleeoError> {
    #[cfg(target_os = "windows")]
    if let Some(win) = app.get_webview_window("main") {
        let toggle = if win.is_menu_visible().unwrap_or(false) {
            win.hide_menu()
        } else {
            win.show_menu()
        };
        toggle.map_err(|e| VoleeoError::Storage(e.to_string()))?;
    }
    let _ = &app;
    Ok(())
}
