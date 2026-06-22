pub mod commands;
mod mcp_server;
mod secret_store;
mod state;

use state::AppState;
use tauri::{Emitter, Manager};

/// The Voleeo + Edit menu. macOS shows it in the global bar; Windows attaches it
/// to the window but hides it by default (revealed with Alt — the OS default).
/// Linux gets no menu. macOS-only predefined items are included only there.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_app_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
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

    // Edit menu only on macOS: it owns the standard clipboard shortcuts there.
    // On Windows the webview already handles copy/paste/undo natively, so a
    // second set of menu accelerators would just conflict.
    #[cfg(target_os = "macos")]
    let menu = menu.item(
        &SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .build()?,
    );

    menu.build()
}

pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::workspace::list_workspaces,
        commands::workspace::create_workspace,
        commands::workspace::workspace_get_key_display,
        commands::workspace::workspace_enable_encryption,
        commands::workspace::workspace_import_key,
        commands::workspace::workspace_get_settings,
        commands::workspace::workspace_list_settings,
        commands::workspace::workspace_save_settings,
        commands::workspace::delete_workspace,
        commands::workspace::rename_workspace,
        commands::workspace::workspace_get_path,
        commands::workspace::workspace_set_sync_dir,
        commands::workspace::workspace_open_folder,
        commands::workspace::workspace_has_key,
        commands::workspace::workspace_encrypt_value,
        commands::workspace::workspace_decrypt_value,
        commands::workspace::update_workspace_headers,
        commands::workspace::update_workspace_auth,
        commands::workspace::update_workspace_dns_overrides,
        commands::request::list_requests,
        commands::request::list_folders,
        commands::request::create_request,
        commands::request::create_folder,
        commands::request::duplicate_request,
        commands::request::duplicate_folder,
        commands::request::rename_request,
        commands::request::update_request,
        commands::request::rename_folder,
        commands::request::update_folder,
        commands::request::update_folder_color,
        commands::request::update_folder_variables,
        commands::request::delete_request,
        commands::request::delete_folder,
        commands::request::move_items,
        commands::import::import_preview,
        commands::import::import_read_file,
        commands::import::import_fetch_url,
        commands::import::import_commit,
        commands::http::send_request,
        commands::http::cancel_request,
        commands::http::sign_auth_headers,
        commands::oauth2::oauth2_token_status,
        commands::oauth2::oauth2_token_details,
        commands::oauth2::oauth2_fetch_token,
        commands::oauth2::oauth2_refresh_token,
        commands::oauth2::oauth2_clear_token,
        commands::oauth2::oauth2_ensure_token,
        commands::graphql::graphql_introspect,
        commands::websocket::list_ws_connections,
        commands::websocket::get_ws_connection,
        commands::websocket::create_ws_connection,
        commands::websocket::duplicate_ws_connection,
        commands::websocket::rename_ws_connection,
        commands::websocket::update_ws_connection,
        commands::websocket::delete_ws_connection,
        commands::websocket::ws_update_position,
        commands::websocket::ws_connect,
        commands::websocket::ws_send_message,
        commands::websocket::ws_disconnect,
        commands::websocket::ws_is_connected,
        commands::websocket::ws_get_transcript,
        commands::websocket::ws_list_sessions,
        commands::websocket::ws_get_session,
        commands::websocket::ws_clear_transcript,
        commands::grpc::crud::list_grpc_requests,
        commands::grpc::crud::get_grpc_request,
        commands::grpc::crud::create_grpc_request,
        commands::grpc::crud::duplicate_grpc_request,
        commands::grpc::crud::rename_grpc_request,
        commands::grpc::crud::update_grpc_request,
        commands::grpc::crud::delete_grpc_request,
        commands::grpc::crud::grpc_update_position,
        commands::grpc::introspect::grpc_list_services,
        commands::grpc::introspect::grpc_refresh_descriptors,
        commands::grpc::introspect::grpc_describe_method,
        commands::grpc::introspect::grpc_describe_message,
        commands::grpc::call::grpc_call,
        commands::grpc::call::grpc_cancel,
        commands::grpc::call::grpc_list_unary_responses,
        commands::grpc::call::grpc_get_unary_response,
        commands::grpc::call::grpc_clear_unary_responses,
        commands::grpc::stream::grpc_stream_start,
        commands::grpc::stream::grpc_stream_send,
        commands::grpc::stream::grpc_stream_close_send,
        commands::grpc::stream::grpc_stream_cancel,
        commands::grpc::stream::grpc_is_active,
        commands::grpc::stream::grpc_get_transcript,
        commands::grpc::stream::grpc_list_sessions,
        commands::grpc::stream::grpc_get_session,
        commands::grpc::stream::grpc_clear_transcript,
        commands::response::response_list,
        commands::response::response_get,
        commands::response::response_clear,
        commands::response::response_body_window,
        commands::response::response_body_search,
        commands::response::response_body_filter,
        commands::settings::settings_get_mcp,
        commands::settings::settings_set_mcp_enabled,
        commands::settings::settings_regenerate_mcp_token,
        commands::settings::settings_get_custom_title_bar,
        commands::settings::settings_set_custom_title_bar,
        commands::settings::settings_get_auto_update,
        commands::settings::settings_set_auto_update,
        commands::settings::reposition_window_controls,
        commands::theme::theme_get_active,
        commands::theme::theme_activate,
        commands::theme::theme_get_color_mode,
        commands::theme::theme_set_color_mode,
        commands::info::get_app_info,
        commands::info::toggle_main_menu,
        commands::debug::debug_entity_info,
        commands::plugin_store::plugin_store_get,
        commands::plugin_store::plugin_store_set,
        commands::plugin_store::plugin_store_delete,
        commands::environment::env_list,
        commands::environment::env_get,
        commands::environment::env_create,
        commands::environment::env_update,
        commands::environment::env_delete,
        commands::cookie::cookies_list_jars,
        commands::cookie::cookies_create_jar,
        commands::cookie::cookies_rename_jar,
        commands::cookie::cookies_delete_jar,
        commands::cookie::cookies_set_active_jar,
        commands::cookie::cookies_get_active_jar,
        commands::cookie::cookies_save_cookie,
        commands::cookie::cookies_delete_cookie,
        commands::cookie::cookies_clear_jar,
        commands::cookie::cookies_clear_expired,
        commands::system_fonts::list_system_fonts,
        commands::git::git_repo_info,
        commands::git::git_init,
        commands::git::git_status,
        commands::git::git_changes,
        commands::git::git_stage,
        commands::git::git_stage_all,
        commands::git::git_unstage,
        commands::git::git_unstage_all,
        commands::git::git_discard,
        commands::git::git_commit,
        commands::git::git_remotes,
        commands::git::git_set_remote,
        commands::git::git_set_upstream,
        commands::git::git_fetch,
        commands::git::git_pull,
        commands::git::git_push,
        commands::git::git_branches,
        commands::git::git_checkout,
        commands::git::git_create_branch,
        commands::git::git_rename_branch,
        commands::git::git_clone_workspace,
        commands::git::git_set_credentials,
        commands::git::git_clear_credentials,
        commands::git::git_credentials_user,
        commands::git::git_set_identity,
        commands::git::git_get_identity,
        commands::git::git_entity_conflicts,
        commands::git::git_resolve_entity,
        commands::git::git_resolve_delete,
        commands::git::git_finish_merge,
        commands::git::git_log,
        commands::git::git_log_for_path,
        commands::git::git_commit_changes,
        commands::git::git_revert_commit,
    ])
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Native macOS titlebar plugin
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(voleeo_mac_window::init());

    // Debug-only E2E bridge: exposes a localhost WebSocket (:9223) so the
    // voleeo-e2e suite can drive the webview. Absent from release builds.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .bind_address("127.0.0.1")
            .build(),
    );

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(build_app_menu(app)?)?;

            // Windows: attach the menu but hide it; Alt reveals it (handled in
            // the webview). Linux keeps no menu.
            #[cfg(target_os = "windows")]
            if let Some(win) = app.get_webview_window("main") {
                win.set_menu(build_app_menu(app)?)?;
                let _ = win.hide_menu();
            }

            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let settings_path = app_dir.join("settings.json");

            let state = tauri::async_runtime::block_on(async {
                AppState::new(settings_path, &app_dir)
                    .await
                    .expect("failed to init state")
            });

            // Spawn the MCP socket server in the background.
            let socket_path = mcp_server::socket_path(&app_dir);
            mcp_server::spawn(&app.handle().clone(), &state, socket_path);

            app.manage(state);
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "close_workspace" {
                if let Some(win) = app.get_webview_window("main") {
                    win.emit("workspace:close", ()).ok();
                }
            } else if event.id() == "settings" {
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
        })
        .on_window_event(|window, event| {
            // The frontend intercepts the main window's close: with a workspace
            // open it prevents the close and steps back to Welcome; on Welcome it
            // lets the close through. When the window is actually destroyed, quit
            // the whole app (and any secondary windows). No prevent_close here, so
            // the window can never get stuck open.
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::list_workspaces,
            commands::workspace::create_workspace,
            commands::workspace::workspace_get_key_display,
            commands::workspace::workspace_enable_encryption,
            commands::workspace::workspace_import_key,
            commands::workspace::workspace_get_settings,
            commands::workspace::workspace_list_settings,
            commands::workspace::workspace_save_settings,
            commands::workspace::delete_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::workspace_get_path,
            commands::workspace::workspace_set_sync_dir,
            commands::workspace::workspace_open_folder,
            commands::workspace::workspace_has_key,
            commands::workspace::workspace_encrypt_value,
            commands::workspace::workspace_decrypt_value,
            commands::workspace::update_workspace_headers,
            commands::workspace::update_workspace_auth,
            commands::workspace::update_workspace_dns_overrides,
            commands::request::list_requests,
            commands::request::list_folders,
            commands::request::create_request,
            commands::request::create_folder,
            commands::request::duplicate_request,
            commands::request::duplicate_folder,
            commands::request::rename_request,
            commands::request::update_request,
            commands::request::rename_folder,
            commands::request::update_folder,
            commands::request::update_folder_color,
            commands::request::update_folder_variables,
            commands::request::delete_request,
            commands::request::delete_folder,
            commands::request::move_items,
            commands::import::import_preview,
            commands::import::import_read_file,
            commands::import::import_fetch_url,
            commands::import::import_commit,
            commands::http::send_request,
            commands::http::cancel_request,
            commands::http::sign_auth_headers,
            commands::oauth2::oauth2_token_status,
            commands::oauth2::oauth2_token_details,
            commands::oauth2::oauth2_fetch_token,
            commands::oauth2::oauth2_refresh_token,
            commands::oauth2::oauth2_clear_token,
            commands::oauth2::oauth2_ensure_token,
            commands::graphql::graphql_introspect,
            commands::websocket::list_ws_connections,
            commands::websocket::get_ws_connection,
            commands::websocket::create_ws_connection,
            commands::websocket::duplicate_ws_connection,
            commands::websocket::rename_ws_connection,
            commands::websocket::update_ws_connection,
            commands::websocket::delete_ws_connection,
            commands::websocket::ws_update_position,
            commands::websocket::ws_connect,
            commands::websocket::ws_send_message,
            commands::websocket::ws_disconnect,
            commands::websocket::ws_is_connected,
            commands::websocket::ws_get_transcript,
            commands::websocket::ws_list_sessions,
            commands::websocket::ws_get_session,
            commands::websocket::ws_clear_transcript,
            commands::grpc::crud::list_grpc_requests,
            commands::grpc::crud::get_grpc_request,
            commands::grpc::crud::create_grpc_request,
            commands::grpc::crud::duplicate_grpc_request,
            commands::grpc::crud::rename_grpc_request,
            commands::grpc::crud::update_grpc_request,
            commands::grpc::crud::delete_grpc_request,
            commands::grpc::crud::grpc_update_position,
            commands::grpc::introspect::grpc_list_services,
            commands::grpc::introspect::grpc_refresh_descriptors,
            commands::grpc::introspect::grpc_describe_method,
            commands::grpc::introspect::grpc_describe_message,
            commands::grpc::call::grpc_call,
            commands::grpc::call::grpc_cancel,
            commands::grpc::call::grpc_list_unary_responses,
            commands::grpc::call::grpc_get_unary_response,
            commands::grpc::call::grpc_clear_unary_responses,
            commands::grpc::stream::grpc_stream_start,
            commands::grpc::stream::grpc_stream_send,
            commands::grpc::stream::grpc_stream_close_send,
            commands::grpc::stream::grpc_stream_cancel,
            commands::grpc::stream::grpc_is_active,
            commands::grpc::stream::grpc_get_transcript,
            commands::grpc::stream::grpc_list_sessions,
            commands::grpc::stream::grpc_get_session,
            commands::grpc::stream::grpc_clear_transcript,
            commands::response::response_list,
            commands::response::response_get,
            commands::response::response_clear,
            commands::response::response_body_window,
            commands::response::response_body_search,
            commands::response::response_body_filter,
            commands::settings::settings_get_mcp,
            commands::settings::settings_set_mcp_enabled,
            commands::settings::settings_regenerate_mcp_token,
            commands::settings::settings_get_custom_title_bar,
            commands::settings::settings_set_custom_title_bar,
            commands::settings::settings_get_auto_update,
            commands::settings::settings_set_auto_update,
            commands::settings::reposition_window_controls,
            commands::theme::theme_get_active,
            commands::theme::theme_activate,
            commands::theme::theme_get_color_mode,
            commands::theme::theme_set_color_mode,
            commands::info::get_app_info,
            commands::info::toggle_main_menu,
            commands::debug::debug_entity_info,
            commands::plugin_store::plugin_store_get,
            commands::plugin_store::plugin_store_set,
            commands::plugin_store::plugin_store_delete,
            commands::environment::env_list,
            commands::environment::env_get,
            commands::environment::env_create,
            commands::environment::env_update,
            commands::environment::env_delete,
            commands::cookie::cookies_list_jars,
            commands::cookie::cookies_create_jar,
            commands::cookie::cookies_rename_jar,
            commands::cookie::cookies_delete_jar,
            commands::cookie::cookies_set_active_jar,
            commands::cookie::cookies_get_active_jar,
            commands::cookie::cookies_save_cookie,
            commands::cookie::cookies_delete_cookie,
            commands::cookie::cookies_clear_jar,
            commands::cookie::cookies_clear_expired,
            commands::system_fonts::list_system_fonts,
            commands::git::git_repo_info,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_changes,
            commands::git::git_stage,
            commands::git::git_stage_all,
            commands::git::git_unstage,
            commands::git::git_unstage_all,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_remotes,
            commands::git::git_set_remote,
            commands::git::git_set_upstream,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_create_branch,
            commands::git::git_rename_branch,
            commands::git::git_clone_workspace,
            commands::git::git_set_credentials,
            commands::git::git_clear_credentials,
            commands::git::git_credentials_user,
            commands::git::git_set_identity,
            commands::git::git_get_identity,
            commands::git::git_entity_conflicts,
            commands::git::git_resolve_entity,
            commands::git::git_resolve_delete,
            commands::git::git_finish_merge,
            commands::git::git_log,
            commands::git::git_log_for_path,
            commands::git::git_commit_changes,
            commands::git::git_revert_commit,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            // RunEvent::Reopen (dock-icon click) is macOS-only.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                use tauri::Manager;
                if let Some(main) = app_handle.get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                for (label, window) in app_handle.webview_windows() {
                    if label == "main" {
                        continue;
                    }
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            #[cfg(not(target_os = "macos"))]
            let _ = (&app_handle, &event);
        });
}
