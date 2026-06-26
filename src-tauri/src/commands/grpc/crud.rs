//! gRPC request CRUD. Mirrors `commands/websocket.rs` CRUD, including the
//! decrypt-on-read / encrypt-on-write auth handling and the plaintext-compare
//! before save.

use serde::Deserialize;
use specta::Type;
use tauri::State;
use voleeo_core::{AuthConfig, GrpcRequest, ProtoSource, RequestParameter, VoleeoError};
use voleeo_storage::GrpcUpdate;

use crate::commands::request::{
    preserve_unchanged_secrets, run_blocking, transform_auth_secrets, Direction, Stores,
};
use crate::state::AppState;

/// Editable fields of a gRPC request, bundled so the command stays within
/// specta's 10-argument limit.
#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequestUpdate {
    pub target: String,
    pub tls: bool,
    pub proto_source: ProtoSource,
    pub service: Option<String>,
    pub method: Option<String>,
    pub metadata: Vec<RequestParameter>,
    pub message: String,
    pub auth: AuthConfig,
}

#[tauri::command]
#[specta::specta]
pub async fn list_grpc_requests(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GrpcRequest>, VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    run_blocking(move || {
        let mut items = grpc.list(&workspace_id)?;
        for r in items.iter_mut() {
            transform_auth_secrets(&mut r.auth, &workspace_id, &stores, Direction::Decrypt)?;
        }
        Ok(items)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<GrpcRequest, VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    run_blocking(move || {
        let mut req = grpc.get(&workspace_id, &id)?;
        transform_auth_secrets(&mut req.auth, &workspace_id, &stores, Direction::Decrypt)?;
        Ok(req)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    folder_id: Option<String>,
    name: String,
    target: String,
) -> Result<GrpcRequest, VoleeoError> {
    let grpc = state.grpc.clone();
    run_blocking(move || grpc.create(workspace_id, folder_id, name, target)).await
}

#[tauri::command]
#[specta::specta]
pub async fn duplicate_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<GrpcRequest, VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    run_blocking(move || {
        let mut req = grpc.duplicate(&workspace_id, &id)?;
        transform_auth_secrets(&mut req.auth, &workspace_id, &stores, Direction::Decrypt)?;
        Ok(req)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    name: String,
) -> Result<(), VoleeoError> {
    let grpc = state.grpc.clone();
    run_blocking(move || grpc.rename(&workspace_id, &id, name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    update: GrpcRequestUpdate,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    let grpc = state.grpc.clone();
    run_blocking(move || {
        // Plaintext compare before encrypting — see `update_ws_connection`.
        let mut current = grpc.get(&workspace_id, &id)?;
        let mut stored_auth = current.auth.clone();
        transform_auth_secrets(
            &mut current.auth,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        let mut next = current.clone();
        next.target = update.target;
        next.tls = update.tls;
        next.proto_source = update.proto_source;
        next.service = update.service;
        next.method = update.method;
        next.metadata = update.metadata;
        next.message = update.message;
        next.auth = update.auth;
        if next == current {
            return Ok(());
        }
        preserve_unchanged_secrets(&mut next.auth, &mut current.auth, &mut stored_auth);
        transform_auth_secrets(&mut next.auth, &workspace_id, &stores, Direction::Encrypt)?;
        grpc.update(
            &workspace_id,
            &id,
            GrpcUpdate {
                target: next.target,
                tls: next.tls,
                proto_source: next.proto_source,
                service: next.service,
                method: next.method,
                metadata: next.metadata,
                message: next.message,
                auth: next.auth,
            },
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_grpc_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    let grpc = state.grpc.clone();
    let responses = state.grpc_responses.clone();
    let transcripts = state.grpc_transcripts.clone();
    state.grpc_manager.cancel(&id);
    state.grpc_executor.cancel(&id); // in-flight unary call, tracked separately
    state.grpc_descriptors.evict(&id);
    let (ws, gid) = (workspace_id.clone(), id.clone());
    run_blocking(move || {
        let _ = responses.clear(&ws, &gid);
        let _ = transcripts.clear(&ws, &gid);
        grpc.delete(&workspace_id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_update_position(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    folder_id: Option<String>,
    order: f64,
) -> Result<(), VoleeoError> {
    let grpc = state.grpc.clone();
    run_blocking(move || grpc.update_position(&workspace_id, &id, folder_id, order)).await
}
