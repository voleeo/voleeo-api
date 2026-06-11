//! Unary gRPC execution + history. Mirrors `commands/http.rs`: resolve
//! `{{ VAR }}` and auth backend-side, run the call (racing a cancel signal),
//! then persist the response to the ring-buffer history.

use tauri::State;
use voleeo_core::{AuthConfig, GrpcResponse, VoleeoError};
use voleeo_storage::StoredGrpcResponseSummary;

use crate::commands::request::{run_blocking, transform_auth_secrets, Direction, Stores};
use crate::state::AppState;

/// `auth_override` short-circuits stored auth (frontend resolved `Inherit`);
/// `message_override` swaps the stored protobuf-JSON payload (form draft).
#[tauri::command]
#[specta::specta]
pub async fn grpc_call(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    environment_id: Option<String>,
    auth_override: Option<AuthConfig>,
    message_override: Option<String>,
) -> Result<GrpcResponse, VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    let environments = state.environments.clone();
    let requests = state.requests.clone();
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    let (ws_id, gid, env_id) = (workspace_id.clone(), id.clone(), environment_id.clone());

    // Resolve env/folder vars + auth → (message JSON, metadata) synchronously.
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
    let resp = state
        .grpc_executor
        .call(&req, &resolved, &message_json, metadata)
        .await?;

    let responses = state.grpc_responses.clone();
    let (ws, rid, to_store) = (workspace_id, id, resp.clone());
    let stored = run_blocking(move || responses.append(&ws, &rid, to_store, 20)).await;
    match stored {
        Ok(s) => Ok(s.response),
        Err(e) => {
            eprintln!("[grpc] failed to store response history: {e}");
            Ok(resp)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_cancel(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), VoleeoError> {
    state.grpc_executor.cancel(&request_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_list_unary_responses(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
) -> Result<Vec<StoredGrpcResponseSummary>, VoleeoError> {
    let responses = state.grpc_responses.clone();
    run_blocking(move || responses.list(&workspace_id, &request_id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_get_unary_response(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
    response_id: String,
) -> Result<GrpcResponse, VoleeoError> {
    let responses = state.grpc_responses.clone();
    run_blocking(move || {
        responses
            .get(&workspace_id, &request_id, &response_id)?
            .map(|s| s.response)
            .ok_or_else(|| VoleeoError::NotFound(format!("response {response_id}")))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_clear_unary_responses(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
) -> Result<(), VoleeoError> {
    let responses = state.grpc_responses.clone();
    run_blocking(move || responses.clear(&workspace_id, &request_id)).await
}
