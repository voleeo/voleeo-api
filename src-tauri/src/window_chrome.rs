use tauri::{plugin, plugin::TauriPlugin, Manager, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::new("voleeo-window-chrome")
        .on_window_ready(|window| {
            let label = window.label();
            let chrome = label == "main" || label.starts_with("ws-");
            if chrome && custom_title_bar_enabled(&window) {
                let _ = window.set_decorations(false);
            }
        })
        .build()
}

fn custom_title_bar_enabled<R: Runtime>(window: &tauri::Window<R>) -> bool {
    let Ok(dir) = window.app_handle().path().app_data_dir() else {
        return true;
    };
    std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("custom_title_bar").and_then(serde_json::Value::as_bool))
        .unwrap_or(true)
}
