#[cfg(target_os = "macos")]
mod mac;

use tauri::{plugin, plugin::TauriPlugin, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let mut builder = plugin::Builder::new("voleeo-mac-window");

    #[cfg(target_os = "macos")]
    {
        builder = builder.on_window_ready(|window| {
            let label = window.label();
            let chrome_window = label == "main" || label.starts_with("ws-");
            if chrome_window && custom_title_bar_enabled(&window) {
                mac::setup_traffic_light_positioner(&window);
            }
        });
    }

    builder.build()
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
