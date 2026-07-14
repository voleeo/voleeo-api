//! WebSocket CRUD + live-session commands. Mirrors `commands/request.rs` for
//! CRUD; lifecycle commands drive `WsManager` and push `ws:*` events.

use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use voleeo_core::{
    new_id, now_iso, AuthConfig, RequestParameter, TimelineEvent, VoleeoError, WsConnection,
    WsMessage, WsMessageKind,
};
use voleeo_storage::{StoredWsSession, StoredWsSessionSummary};
use voleeo_ws::{WsEvent, WsEventSink};

use crate::commands::request::{
    preserve_unchanged_secrets, run_blocking, transform_auth_secrets, Direction, Stores,
};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn list_ws_connections(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WsConnection>, VoleeoError> {
    let stores = Stores::from(&state);
    let ws = state.ws.clone();
    run_blocking(move || {
        let mut conns = ws.list(&workspace_id)?;
        for c in conns.iter_mut() {
            transform_auth_secrets(&mut c.auth, &workspace_id, &stores, Direction::Decrypt)?;
        }
        Ok(conns)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<WsConnection, VoleeoError> {
    let stores = Stores::from(&state);
    let ws = state.ws.clone();
    run_blocking(move || {
        let mut conn = ws.get(&workspace_id, &id)?;
        transform_auth_secrets(&mut conn.auth, &workspace_id, &stores, Direction::Decrypt)?;
        Ok(conn)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    folder_id: Option<String>,
    name: String,
    url: String,
) -> Result<WsConnection, VoleeoError> {
    let ws = state.ws.clone();
    run_blocking(move || ws.create(workspace_id, folder_id, name, url)).await
}

#[tauri::command]
#[specta::specta]
pub async fn duplicate_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<WsConnection, VoleeoError> {
    let stores = Stores::from(&state);
    let ws = state.ws.clone();
    run_blocking(move || {
        let mut conn = ws.duplicate(&workspace_id, &id)?;
        transform_auth_secrets(&mut conn.auth, &workspace_id, &stores, Direction::Decrypt)?;
        Ok(conn)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    name: String,
) -> Result<(), VoleeoError> {
    let ws = state.ws.clone();
    run_blocking(move || ws.rename(&workspace_id, &id, name)).await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn update_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    url: String,
    parameters: Vec<RequestParameter>,
    headers: Vec<RequestParameter>,
    auth: AuthConfig,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    let ws = state.ws.clone();
    run_blocking(move || {
        // Plaintext compare before encrypting — see `update_request`.
        let mut current = ws.get(&workspace_id, &id)?;
        let mut stored_auth = current.auth.clone();
        transform_auth_secrets(
            &mut current.auth,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        let mut next = current.clone();
        next.url = url;
        next.parameters = parameters;
        next.headers = headers;
        next.auth = auth;
        if next == current {
            return Ok(());
        }
        preserve_unchanged_secrets(&mut next.auth, &mut current.auth, &mut stored_auth);
        transform_auth_secrets(&mut next.auth, &workspace_id, &stores, Direction::Encrypt)?;
        ws.update(
            &workspace_id,
            &id,
            next.url,
            next.parameters,
            next.headers,
            next.auth,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_ws_connection(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    let ws = state.ws.clone();
    let transcripts = state.ws_transcripts.clone();
    let conn_id = id.clone();
    let ws_id = workspace_id.clone();
    run_blocking(move || {
        let _ = transcripts.clear(&ws_id, &conn_id);
        ws.delete(&workspace_id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_update_position(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    folder_id: Option<String>,
    order: f64,
) -> Result<(), VoleeoError> {
    let ws = state.ws.clone();
    run_blocking(move || ws.update_position(&workspace_id, &id, folder_id, order)).await
}

/// Build the sink the manager calls for every inbound frame / lifecycle event:
/// emit a small `ws:*` event to the frontend and persist to the transcript.
fn build_sink(
    app: AppHandle,
    state: &AppState,
    workspace_id: String,
    connection_id: String,
) -> WsEventSink {
    let transcripts = state.ws_transcripts.clone();
    Arc::new(move |ev: WsEvent| match ev {
        WsEvent::Status(status) => {
            let _ = app.emit(
                "ws:status",
                json!({ "connectionId": connection_id, "status": status }),
            );
        }
        WsEvent::Message(msg) => {
            let _ = app.emit(
                "ws:message",
                json!({ "connectionId": connection_id, "message": &msg }),
            );
            let (t, ws, c) = (
                transcripts.clone(),
                workspace_id.clone(),
                connection_id.clone(),
            );
            tauri::async_runtime::spawn_blocking(move || {
                let _ = t.append_message(&ws, &c, msg);
            });
        }
        WsEvent::Timeline(event) => {
            let _ = app.emit(
                "ws:timeline",
                json!({ "connectionId": connection_id, "event": &event }),
            );
            let (t, ws, c) = (
                transcripts.clone(),
                workspace_id.clone(),
                connection_id.clone(),
            );
            tauri::async_runtime::spawn_blocking(move || {
                let _ = t.append_event(&ws, &c, event);
            });
        }
    })
}

/// Resolves env/folder vars + auth backend-side; `auth_override` short-circuits
/// the stored auth (frontend uses it for already-walked `Inherit`).
#[tauri::command]
#[specta::specta]
pub async fn ws_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
    environment_id: Option<String>,
    auth_override: Option<AuthConfig>,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    let ws = state.ws.clone();
    let environments = state.environments.clone();
    let requests = state.requests.clone();
    let app_data_dir = state.app_data_dir.clone();
    let (ws_id, conn_id, env_id) = (
        workspace_id.clone(),
        connection_id.clone(),
        environment_id.clone(),
    );

    let transcripts = state.ws_transcripts.clone();
    let (url, headers) = run_blocking(move || {
        let mut conn = ws.get(&ws_id, &conn_id)?;
        if let Some(auth) = auth_override {
            // Frontend already resolved inheritance; trust it. (Secrets in the
            // override travel plaintext over IPC, same as `request.send`.)
            conn.auth = auth;
        } else {
            transform_auth_secrets(&mut conn.auth, &ws_id, &stores, Direction::Decrypt)?;
        }
        let envs = environments.list(&ws_id).unwrap_or_default();
        let mut vars = voleeo_mcp::resolve::load_env_vars_from(
            &envs,
            &ws_id,
            env_id.as_deref(),
            &app_data_dir,
        );
        let folders = requests.list_folders(&ws_id).unwrap_or_default();
        let key = voleeo_crypto::load_key_from_file(&ws_id, &app_data_dir).ok();
        voleeo_mcp::resolve::apply_folder_vars(
            &mut vars,
            conn.folder_id.as_deref(),
            &folders,
            key.as_ref(),
        );
        let resolved = voleeo_mcp::resolve::apply_to_connection(&conn, &vars);
        // Open a fresh history session so handshake/open events + messages from
        // this connect land in their own entry.
        let _ = transcripts.start_session(&ws_id, &conn_id);
        Ok::<(String, Vec<(String, String)>), VoleeoError>(resolved)
    })
    .await?;

    let sink = build_sink(app, &state, workspace_id, connection_id.clone());
    state
        .ws_manager
        .connect(connection_id, url, headers, sink)
        .await
}

/// Send a message (optimistic): `{{ VAR }}` tokens in text payloads are resolved,
/// then the outbound row is emitted + persisted immediately and enqueued.
#[tauri::command]
#[specta::specta]
pub async fn ws_send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
    kind: WsMessageKind,
    data: String,
    environment_id: Option<String>,
) -> Result<WsMessage, VoleeoError> {
    // Binary payloads are base64 — leave untouched; resolve text only.
    let resolved = if matches!(kind, WsMessageKind::Text) {
        let ws = state.ws.clone();
        let environments = state.environments.clone();
        let requests = state.requests.clone();
        let app_data_dir = state.app_data_dir.clone();
        let (ws_id, conn_id, env_id, raw) = (
            workspace_id.clone(),
            connection_id.clone(),
            environment_id.clone(),
            data.clone(),
        );
        run_blocking(move || {
            let conn = ws.get(&ws_id, &conn_id)?;
            let envs = environments.list(&ws_id).unwrap_or_default();
            let mut vars = voleeo_mcp::resolve::load_env_vars_from(
                &envs,
                &ws_id,
                env_id.as_deref(),
                &app_data_dir,
            );
            let folders = requests.list_folders(&ws_id).unwrap_or_default();
            let key = voleeo_crypto::load_key_from_file(&ws_id, &app_data_dir).ok();
            voleeo_mcp::resolve::apply_folder_vars(
                &mut vars,
                conn.folder_id.as_deref(),
                &folders,
                key.as_ref(),
            );
            Ok(voleeo_mcp::resolve::resolve_str(&raw, &vars))
        })
        .await?
    } else {
        data.clone()
    };

    state
        .ws_manager
        .send_message(&connection_id, kind, resolved.clone())?;

    let msg = WsMessage {
        id: new_id(),
        direction: voleeo_core::WsDirection::Outgoing,
        kind,
        data: resolved.clone(),
        size: resolved.len() as u32,
        at: now_iso(),
    };
    let _ = app.emit(
        "ws:message",
        json!({ "connectionId": connection_id, "message": &msg }),
    );
    let transcripts = state.ws_transcripts.clone();
    let (ws, c, stored) = (workspace_id, connection_id, msg.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _ = transcripts.append_message(&ws, &c, stored);
    });
    Ok(msg)
}

#[tauri::command]
#[specta::specta]
pub async fn ws_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
) -> Result<(), VoleeoError> {
    state.ws_manager.disconnect(&connection_id);
    let _ = app.emit(
        "ws:status",
        json!({ "connectionId": connection_id, "status": "closed" }),
    );
    let event = TimelineEvent {
        at_ms: 0.0,
        kind: "close".into(),
        text: "Disconnected".into(),
    };
    let _ = app.emit(
        "ws:timeline",
        json!({ "connectionId": connection_id, "event": &event }),
    );
    let transcripts = state.ws_transcripts.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = transcripts.append_event(&workspace_id, &connection_id, event);
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ws_is_connected(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<bool, VoleeoError> {
    Ok(state.ws_manager.is_connected(&connection_id))
}

/// The current (newest) session — used to hydrate the live transcript on mount.
#[tauri::command]
#[specta::specta]
pub async fn ws_get_transcript(
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
) -> Result<StoredWsSession, VoleeoError> {
    let transcripts = state.ws_transcripts.clone();
    run_blocking(move || Ok(transcripts.latest(&workspace_id, &connection_id))).await
}

/// Session history (newest first) for the connection's history picker.
#[tauri::command]
#[specta::specta]
pub async fn ws_list_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
) -> Result<Vec<StoredWsSessionSummary>, VoleeoError> {
    let transcripts = state.ws_transcripts.clone();
    run_blocking(move || Ok(transcripts.list_sessions(&workspace_id, &connection_id))).await
}

/// A single past session's full transcript + lifecycle events.
#[tauri::command]
#[specta::specta]
pub async fn ws_get_session(
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
    session_id: String,
) -> Result<StoredWsSession, VoleeoError> {
    let transcripts = state.ws_transcripts.clone();
    run_blocking(move || {
        transcripts
            .get_session(&workspace_id, &connection_id, &session_id)
            .ok_or_else(|| VoleeoError::NotFound(format!("session {session_id}")))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_clear_transcript(
    state: State<'_, AppState>,
    workspace_id: String,
    connection_id: String,
) -> Result<(), VoleeoError> {
    let transcripts = state.ws_transcripts.clone();
    run_blocking(move || transcripts.clear(&workspace_id, &connection_id)).await
}
