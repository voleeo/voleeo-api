#[cfg(target_os = "macos")]
mod mac;

use tauri::{plugin, plugin::TauriPlugin, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let mut builder = plugin::Builder::new("voleeo-mac-window");

    #[cfg(target_os = "macos")]
    {
        builder = builder.on_window_ready(|window| {
            if should_decorate(&window) {
                mac::setup_traffic_light_positioner(&window);
            }
        });
    }

    builder.build()
}

// True for the windows that get the overlay title bar (main + per-workspace
// chrome), and only when the user hasn't turned the custom bar off.
#[cfg(target_os = "macos")]
fn should_decorate<R: Runtime>(window: &tauri::Window<R>) -> bool {
    let label = window.label();
    let chrome = label == "main" || label.starts_with("ws-");
    chrome && custom_title_bar_enabled(window)
}

/// Re-apply the custom traffic-light position. Call from a layout-settled moment
/// (e.g. `on_page_load`) so release builds, which lay out the title bar after the
/// window is ready, don't leave the buttons at their default spots.
#[cfg(target_os = "macos")]
pub fn reposition_traffic_lights<R: Runtime>(window: &tauri::Window<R>) {
    if should_decorate(window) {
        mac::reposition(window);
    }
}

// Reads the persisted `custom_title_bar` setting straight from settings.json.
#[cfg(target_os = "macos")]
fn custom_title_bar_enabled<R: Runtime>(window: &tauri::Window<R>) -> bool {
    use tauri::Manager;
    let Ok(dir) = window.app_handle().path().app_data_dir() else {
        return true; // macOS default: overlay title bar on
    };
    std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.get("custom_title_bar")
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(true)
}
