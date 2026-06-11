//! Schema introspection: list services/methods and describe a method's or
//! message's shape so the frontend can render the generated form. All routes go
//! through the per-request descriptor cache.

use tauri::State;
use voleeo_core::{ProtoMessageSchema, ProtoMethodInfo, ProtoServiceInfo, VoleeoError};

use crate::commands::grpc::load_and_resolve;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn grpc_list_services(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    environment_id: Option<String>,
) -> Result<Vec<ProtoServiceInfo>, VoleeoError> {
    let (_, resolved) = load_and_resolve(&state, workspace_id, id, environment_id, false).await?;
    Ok(resolved.services.clone())
}

/// Force a fresh descriptor build (reflection re-query / `.proto` recompile).
#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_descriptors(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    environment_id: Option<String>,
) -> Result<Vec<ProtoServiceInfo>, VoleeoError> {
    let (_, resolved) = load_and_resolve(&state, workspace_id, id, environment_id, true).await?;
    Ok(resolved.services.clone())
}

/// The full method info (input schema + RPC kind) the form renders from.
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe_method(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    service: String,
    method: String,
    environment_id: Option<String>,
) -> Result<ProtoMethodInfo, VoleeoError> {
    let (_, resolved) = load_and_resolve(&state, workspace_id, id, environment_id, false).await?;
    resolved
        .services
        .iter()
        .find(|s| s.name == service)
        .and_then(|s| s.methods.iter().find(|m| m.name == method))
        .cloned()
        .ok_or_else(|| VoleeoError::NotFound(format!("method {service}/{method}")))
}

/// Schema for an arbitrary message by full name — backs lazy `MessageRef`
/// expansion in the form (e.g. recursive or deeply-nested types).
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe_message(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    message: String,
    environment_id: Option<String>,
) -> Result<ProtoMessageSchema, VoleeoError> {
    let (_, resolved) = load_and_resolve(&state, workspace_id, id, environment_id, false).await?;
    resolved
        .describe_message(&message)
        .ok_or_else(|| VoleeoError::NotFound(format!("message {message}")))
}
