use tauri::{plugin, plugin::TauriPlugin, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::new("voleeo-window-chrome")
        .on_window_ready(|window| {
            let label = window.label();
            if label == "main" || label.starts_with("ws-") {
                let _ = window.set_decorations(false);
            }
        })
        .build()
}
