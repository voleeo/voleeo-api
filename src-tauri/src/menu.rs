//! Native application menu. macOS shows it in the global bar; Windows attaches
//! a hidden menu (Alt reveals it); Linux gets none. App-action items emit a
//! single `menu:action` event carrying their id to the focused window, where
//! the frontend dispatcher (`menuActions.ts`) runs the matching store action.
//! Window/clipboard/full-screen items use Tauri predefined items so macOS
//! injects its native extras (tiling, Writing Tools) for free.

use tauri::{Emitter, EventTarget, Manager};

const DOCS_URL: &str = "https://voleeo.com/docs/voleeo-api";
const BUG_URL: &str = "https://github.com/voleeo/voleeo-app/issues/new?template=bug_report.md";

/// The Voleeo + Edit menu plus (macOS only) File/View/Window/Help. macOS shows
/// it globally; Windows attaches it to the window and hides it by default.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn build_app_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let settings_item = MenuItemBuilder::with_id("settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let close_workspace_item =
        MenuItemBuilder::with_id("close_workspace", "Close Workspace").build(app)?;

    let mut app_menu = SubmenuBuilder::new(app, "Voleeo")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&settings_item)
        .item(&close_workspace_item);

    #[cfg(target_os = "macos")]
    {
        app_menu = app_menu
            .separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?);
    }

    let app_menu = app_menu
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app).item(&app_menu);

    // File/Edit/View/Window/Help are macOS-only: they carry native items macOS
    // injects for free (window tiling, Writing Tools, full-screen) and own the
    // key accelerators. On Windows the webview handles clipboard/zoom natively
    // and the menu stays hidden, so a second set of accelerators would clash.
    #[cfg(target_os = "macos")]
    let menu = {
        // New ▸ mirrors the tree's "+" button. Needs an open workspace, so the
        // whole submenu starts disabled and the frontend enables it once one is
        // active (see set_workspace_items_enabled). Import/Export work from the
        // welcome screen too (import into a new workspace, export picks its
        // own), so they stay enabled.
        let new_menu = SubmenuBuilder::with_id(app, "new_menu", "New")
            .enabled(false)
            .item(&MenuItemBuilder::with_id("new_request", "HTTP Request").build(app)?)
            .item(&MenuItemBuilder::with_id("new_graphql", "GraphQL").build(app)?)
            .item(&MenuItemBuilder::with_id("new_websocket", "WebSocket").build(app)?)
            .item(&MenuItemBuilder::with_id("new_grpc", "gRPC").build(app)?)
            .separator()
            .item(&MenuItemBuilder::with_id("new_folder", "Folder").build(app)?)
            .build()?;

        let file = SubmenuBuilder::new(app, "File")
            .item(&new_menu)
            .separator()
            .item(&MenuItemBuilder::with_id("import", "Import…").build(app)?)
            .item(&MenuItemBuilder::with_id("export", "Export…").build(app)?)
            .separator()
            .item(&PredefinedMenuItem::close_window(app, None)?)
            .build()?;

        let edit = SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .build()?;

        let view = SubmenuBuilder::new(app, "View")
            .item(
                &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                    .accelerator("CmdOrCtrl+=")
                    .build(app)?,
            )
            .item(
                &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                    .accelerator("CmdOrCtrl+-")
                    .build(app)?,
            )
            .item(
                &MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                    .accelerator("CmdOrCtrl+0")
                    .build(app)?,
            )
            .separator()
            // Workspace-view actions; disabled until a workspace is open.
            .item(
                &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                    .enabled(false)
                    .build(app)?,
            )
            .item(
                &MenuItemBuilder::with_id("toggle_layout", "Toggle Layout")
                    .enabled(false)
                    .build(app)?,
            )
            .separator()
            .item(&PredefinedMenuItem::fullscreen(app, None)?)
            .build()?;

        // The native window items (Fill, Center, Move & Resize, Full Screen
        // Tile, the open-window list) are injected by macOS once this submenu is
        // registered as the NSApp windows menu — done in register_role_menus
        // AFTER the menu is installed (order matters; naming alone isn't enough).
        let window = SubmenuBuilder::new(app, "Window")
            .item(&PredefinedMenuItem::minimize(app, None)?)
            .item(&PredefinedMenuItem::maximize(app, None)?)
            .build()?;

        let help = SubmenuBuilder::new(app, "Help")
            .item(&MenuItemBuilder::with_id("show_shortcuts", "Keyboard Shortcuts").build(app)?)
            .separator()
            .item(&MenuItemBuilder::with_id("help_docs", "Documentation").build(app)?)
            .item(&MenuItemBuilder::with_id("help_bug", "Report a Bug").build(app)?)
            .build()?;

        menu.item(&file)
            .item(&edit)
            .item(&view)
            .item(&window)
            .item(&help)
    };

    menu.build()
}

/// Register the Window/Help submenus with NSApp so macOS injects its native
/// items (window tiling under Window; the Help search field). Must run AFTER
/// `set_menu` installs the menu — the association is otherwise dropped.
#[cfg(target_os = "macos")]
pub fn register_role_menus(app: &tauri::AppHandle) {
    let Some(menu) = app.menu() else { return };
    let Ok(items) = menu.items() else { return };
    for kind in items {
        let Some(submenu) = kind.as_submenu() else {
            continue;
        };
        match submenu.text().as_deref() {
            Ok("Window") => {
                let _ = submenu.set_as_windows_menu_for_nsapp();
            }
            Ok("Help") => {
                let _ = submenu.set_as_help_menu_for_nsapp();
            }
            _ => {}
        }
    }
}

/// Route a menu click. Window ops and external links are handled here; every
/// app action forwards its id to the focused window's frontend dispatcher.
pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "close_workspace" => {
            if let Some(win) = app.get_webview_window("main") {
                win.emit("workspace:close", ()).ok();
            }
        }
        "settings" => open_settings_window(app),
        "help_docs" => open_external(DOCS_URL),
        "help_bug" => open_external(BUG_URL),
        id @ ("new_request" | "new_graphql" | "new_websocket" | "new_grpc" | "new_folder"
        | "import" | "export" | "zoom_in" | "zoom_out" | "zoom_reset" | "toggle_sidebar"
        | "toggle_layout" | "show_shortcuts") => {
            emit_menu_action(app, id);
        }
        _ => {}
    }
}

/// Emit `menu:action` to the focused window only (falling back to main), so the
/// action lands in the window the user is looking at when several are open.
fn emit_menu_action(app: &tauri::AppHandle, id: &str) {
    let label = app
        .webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
        .unwrap_or_else(|| "main".to_string());
    let _ = app.emit_to(EventTarget::webview_window(label), "menu:action", id);
}

/// Enable/disable the menu entries that need an open workspace (the New
/// submenu, Toggle Sidebar, Toggle Layout) — the frontend greys them out until
/// one is active. `Menu::get` is top-level only, so descend into the submenus.
#[cfg(target_os = "macos")]
pub fn set_workspace_items_enabled(app: &tauri::AppHandle, enabled: bool) {
    use tauri::menu::MenuItemKind;
    const WORKSPACE_ITEMS: [&str; 3] = ["new_menu", "toggle_sidebar", "toggle_layout"];
    let Some(menu) = app.menu() else { return };
    let Ok(items) = menu.items() else { return };
    for kind in items {
        let Some(submenu) = kind.as_submenu() else {
            continue;
        };
        for id in WORKSPACE_ITEMS {
            match submenu.get(id) {
                Some(MenuItemKind::MenuItem(item)) => {
                    let _ = item.set_enabled(enabled);
                }
                Some(MenuItemKind::Submenu(sub)) => {
                    let _ = sub.set_enabled(enabled);
                }
                _ => {}
            }
        }
    }
}

fn open_external(url: &str) {
    let _ = open::that(url);
}

fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().ok();
        win.set_focus().ok();
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Settings")
        .inner_size(900.0, 600.0)
        .min_inner_size(600.0, 400.0)
        .resizable(true)
        .build()
        .ok();
    }
}
