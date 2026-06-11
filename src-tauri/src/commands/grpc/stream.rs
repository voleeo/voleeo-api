//! Streaming gRPC commands (server/client/bidi). Mirror `ws_connect`/
//! `ws_send_message`/`ws_disconnect`: resolve vars + auth backend-side, drive
//! `GrpcManager`, and push `grpc:status`/`grpc:message`/`grpc:timeline` events
//! while persisting to the transcript store.

use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use voleeo_core::{
    now_iso, AuthConfig, GrpcRpcKind, GrpcStreamMessage, TimelineEvent, VoleeoError, WsDirection,
};
use voleeo_grpc::{GrpcEvent, GrpcEventSink, StreamSpec};
use voleeo_storage::{StoredGrpcSession, StoredGrpcSessionSummary};

use crate::commands::request::{run_blocking, transform_auth_secrets, Direction, Stores};
use crate::state::AppState;

/// Emit `grpc:*` events to the frontend and persist them to the transcript.
fn build_sink(
    app: AppHandle,
    state: &AppState,
    workspace_id: String,
    request_id: String,
) -> GrpcEventSink {
    let transcripts = state.grpc_transcripts.clone();
    Arc::new(move |ev: GrpcEvent| match ev {
        GrpcEvent::Status(status) => {
            let _ = app.emit(
                "grpc:status",
                json!({ "requestId": request_id, "status": status }),
            );
        }
        GrpcEvent::Message(msg) => {
            let _ = app.emit(
                "grpc:message",
                json!({ "requestId": request_id, "message": &msg }),
            );
            let (t, ws, r) = (
                transcripts.clone(),
                workspace_id.clone(),
                request_id.clone(),
            );
            tauri::async_runtime::spawn_blocking(move || {
                let _ = t.append_message(&ws, &r, msg);
            });
        }
        GrpcEvent::Timeline(event) => {
            let _ = app.emit(
                "grpc:timeline",
                json!({ "requestId": request_id, "event": &event }),
            );
            let (t, ws, r) = (
                transcripts.clone(),
                workspace_id.clone(),
                request_id.clone(),
            );
            tauri::async_runtime::spawn_blocking(move || {
                let _ = t.append_event(&ws, &r, event);
            });
        }
    })
}

/// Open a streaming call. `message_override` swaps the stored first-message
/// payload (form draft); `auth_override` short-circuits stored `Inherit` auth.
#[tauri::command]
#[specta::specta]
pub async fn grpc_stream_start(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    environment_id: Option<String>,
    auth_override: Option<AuthConfig>,
    message_override: Option<String>,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    let environments = state.environments.clone();
    let requests = state.requests.clone();
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    let (ws_id, gid, env_id) = (workspace_id.clone(), id.clone(), environment_id.clone());

    let (req, message_json, metadata) = run_blocking(move || {
        let mut req = grpc.get(&ws_id, &gid)?;
        if let Some(auth) = auth_override {
            req.auth = auth;
        } else {
            transform_auth_secrets(&mut req.auth, &ws_id, &stores, Direction::Decrypt)?;
        }
        if let Some(msg) = message_override {
            req.message = msg;
        }
        Ok::<_, VoleeoError>(voleeo_mcp::resolve::resolve_grpc_for_send(
            req,
            env_id.as_deref(),
            &environments,
            &requests,
            &workspaces,
            &app_data_dir,
        ))
    })
    .await?;

    let resolved = state
        .grpc_descriptors
        .get_or_build(&id, &req.proto_source, &req.target, req.tls)
        .await?;
    let service = req
        .service
        .clone()
        .ok_or_else(|| VoleeoError::InvalidConfig("no service selected".into()))?;
    let method_name = req
        .method
        .clone()
        .ok_or_else(|| VoleeoError::InvalidConfig("no method selected".into()))?;
    let method = resolved.method(&service, &method_name)?;

    // Fresh history session — only once the method resolved, so a misconfigured
    // request doesn't persist an empty session per failed attempt.
    let transcripts = state.grpc_transcripts.clone();
    let (ws, gid) = (workspace_id.clone(), id.clone());
    run_blocking(move || {
        let _ = transcripts.start_session(&ws, &gid);
        Ok::<_, VoleeoError>(())
    })
    .await?;
    let kind = match (method.is_client_streaming(), method.is_server_streaming()) {
        (false, false) => GrpcRpcKind::Unary,
        (false, true) => GrpcRpcKind::ServerStreaming,
        (true, false) => GrpcRpcKind::ClientStreaming,
        (true, true) => GrpcRpcKind::Bidi,
    };
    let first = (!message_json.trim().is_empty()).then_some(message_json);

    let sink = build_sink(app, &state, workspace_id, id.clone());
    state
        .grpc_manager
        .start_stream(
            StreamSpec {
                id,
                target: req.target,
                tls: req.tls,
                service,
                kind,
                metadata,
            },
            &method,
            first,
            sink,
        )
        .await
}

/// Send a client→server message (client-streaming/bidi). `{{ VAR }}` tokens in
/// the JSON payload are resolved; the row is emitted + persisted optimistically.
#[tauri::command]
#[specta::specta]
pub async fn grpc_stream_send(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    message: String,
    environment_id: Option<String>,
) -> Result<GrpcStreamMessage, VoleeoError> {
    let grpc = state.grpc.clone();
    let environments = state.environments.clone();
    let requests = state.requests.clone();
    let app_data_dir = state.app_data_dir.clone();
    let (ws_id, gid, env_id, raw) = (
        workspace_id.clone(),
        id.clone(),
        environment_id.clone(),
        message.clone(),
    );
    let resolved = run_blocking(move || {
        let req = grpc.get(&ws_id, &gid)?;
        let vars = voleeo_mcp::resolve::grpc_vars(
            &ws_id,
            req.folder_id.as_deref(),
            env_id.as_deref(),
            &environments,
            &requests,
            &app_data_dir,
        );
        Ok::<_, VoleeoError>(voleeo_mcp::resolve::resolve_str(&raw, &vars))
    })
    .await?;

    state.grpc_manager.send_message(&id, &resolved)?;

    let msg = GrpcStreamMessage {
        id: voleeo_core::new_id(),
        direction: WsDirection::Outgoing,
        size: resolved.len() as u32,
        data: resolved,
        at: now_iso(),
    };
    let _ = app.emit("grpc:message", json!({ "requestId": id, "message": &msg }));
    let transcripts = state.grpc_transcripts.clone();
    let (ws, r, stored) = (workspace_id, id, msg.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _ = transcripts.append_message(&ws, &r, stored);
    });
    Ok(msg)
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_stream_close_send(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), VoleeoError> {
    state.grpc_manager.close_send(&id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_stream_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    state.grpc_manager.cancel(&id);
    let _ = app.emit("grpc:status", json!({ "requestId": id, "status": "done" }));
    let event = TimelineEvent {
        at_ms: 0.0,
        kind: "close".into(),
        text: "Stream cancelled".into(),
    };
    let _ = app.emit("grpc:timeline", json!({ "requestId": id, "event": &event }));
    let transcripts = state.grpc_transcripts.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = transcripts.append_event(&workspace_id, &id, event);
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_is_active(state: State<'_, AppState>, id: String) -> Result<bool, VoleeoError> {
    Ok(state.grpc_manager.is_active(&id))
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_get_transcript(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<StoredGrpcSession, VoleeoError> {
    let transcripts = state.grpc_transcripts.clone();
    run_blocking(move || Ok(transcripts.latest(&workspace_id, &id))).await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_list_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<Vec<StoredGrpcSessionSummary>, VoleeoError> {
    let transcripts = state.grpc_transcripts.clone();
    run_blocking(move || Ok(transcripts.list_sessions(&workspace_id, &id))).await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_get_session(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    session_id: String,
) -> Result<StoredGrpcSession, VoleeoError> {
    let transcripts = state.grpc_transcripts.clone();
    run_blocking(move || {
        transcripts
            .get_session(&workspace_id, &id, &session_id)
            .ok_or_else(|| VoleeoError::NotFound(format!("session {session_id}")))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_clear_transcript(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    let transcripts = state.grpc_transcripts.clone();
    run_blocking(move || transcripts.clear(&workspace_id, &id)).await
}
