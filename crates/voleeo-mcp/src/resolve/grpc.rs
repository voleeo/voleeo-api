//! gRPC send-time resolution, shared by the Tauri commands and MCP tools:
//! env/folder vars, inherited metadata, `{{ VAR }}` expansion in
//! target/message/metadata, and auth → metadata mapping.

use std::collections::HashMap;
use std::path::Path;

use voleeo_core::{ApiFolder, AuthConfig, GrpcRequest};
use voleeo_storage::{EnvironmentStore, RequestStore, WorkspaceStore};

use super::text::base64_encode;
use super::vars::{apply_folder_vars, load_env_vars, merge_inherited_metadata, resolve_str};

/// Env + folder vars in a gRPC request's scope — for callers that only need
/// string resolution (target preview, stream payloads).
pub fn grpc_vars(
    workspace_id: &str,
    folder_id: Option<&str>,
    env_id: Option<&str>,
    environments: &EnvironmentStore,
    requests: &RequestStore,
    app_data_dir: &Path,
) -> HashMap<String, String> {
    let folders = requests.list_folders(workspace_id).unwrap_or_default();
    vars_in_scope(
        workspace_id,
        folder_id,
        env_id,
        environments,
        &folders,
        app_data_dir,
    )
}

/// Full send-time resolution. `req` arrives with caller overrides
/// (auth/message/service/method) already applied; returns the request with
/// resolved target + merged metadata, the resolved message JSON, and the
/// metadata pairs to send. Does blocking store/key-file I/O — call from a
/// blocking context.
pub fn resolve_grpc_for_send(
    mut req: GrpcRequest,
    env_id: Option<&str>,
    environments: &EnvironmentStore,
    requests: &RequestStore,
    workspaces: &WorkspaceStore,
    app_data_dir: &Path,
) -> (GrpcRequest, String, Vec<(String, String)>) {
    let ws_id = req.workspace_id.clone();
    let folders = requests.list_folders(&ws_id).unwrap_or_default();
    let vars = vars_in_scope(
        &ws_id,
        req.folder_id.as_deref(),
        env_id,
        environments,
        &folders,
        app_data_dir,
    );
    let ws_headers = workspaces
        .get(&ws_id)
        .map(|w| w.headers)
        .unwrap_or_default();
    req.metadata = merge_inherited_metadata(
        &req.metadata,
        req.folder_id.as_deref(),
        &folders,
        &ws_headers,
    );
    let (target, message, metadata) = apply_to_grpc(&req, &vars);
    req.target = target;
    (req, message, metadata)
}

fn vars_in_scope(
    workspace_id: &str,
    folder_id: Option<&str>,
    env_id: Option<&str>,
    environments: &EnvironmentStore,
    folders: &[ApiFolder],
    app_data_dir: &Path,
) -> HashMap<String, String> {
    let mut vars = load_env_vars(environments, workspace_id, env_id, app_data_dir);
    let key = voleeo_crypto::load_key_from_file(workspace_id, app_data_dir).ok();
    apply_folder_vars(&mut vars, folder_id, folders, key.as_ref());
    vars
}

/// gRPC equivalent of `apply_to_connection`: resolve `{{ VAR }}` in the target,
/// the protobuf-JSON message, and metadata values, and map `auth` to gRPC
/// metadata (always header-style; there is no query string). Returns the
/// resolved `target`, message JSON, and metadata.
pub fn apply_to_grpc(
    req: &GrpcRequest,
    vars: &HashMap<String, String>,
) -> (String, String, Vec<(String, String)>) {
    let target = resolve_str(&req.target, vars);
    let message = resolve_str(&req.message, vars);
    let mut metadata: Vec<(String, String)> = req
        .metadata
        .iter()
        .filter(|p| p.enabled && !p.name.trim().is_empty())
        .map(|p| (resolve_str(&p.name, vars), resolve_str(&p.value, vars)))
        .collect();

    // A disabled (toggled-off) scheme applies nothing.
    let none = AuthConfig::None;
    let effective_auth = if req.auth.is_active() {
        &req.auth
    } else {
        &none
    };
    match effective_auth {
        AuthConfig::Bearer { token, .. } => {
            metadata.push((
                "authorization".into(),
                format!("Bearer {}", resolve_str(token, vars)),
            ));
        }
        AuthConfig::Basic {
            username, password, ..
        } => {
            let encoded = base64_encode(
                format!(
                    "{}:{}",
                    resolve_str(username, vars),
                    resolve_str(password, vars)
                )
                .as_bytes(),
            );
            metadata.push(("authorization".into(), format!("Basic {encoded}")));
        }
        AuthConfig::ApiKey { key, value, .. } => {
            // gRPC carries the key as metadata regardless of the stored location.
            let k = resolve_str(key, vars);
            if !k.trim().is_empty() {
                metadata.push((k, resolve_str(value, vars)));
            }
        }
        AuthConfig::None | AuthConfig::Inherit { .. } => {}
        // SigV4 is HTTP-only; a gRPC request inheriting it sends no auth.
        AuthConfig::AwsSigV4 { .. }
        | AuthConfig::OAuth1 { .. }
        | AuthConfig::OAuth2 { .. }
        | AuthConfig::Digest { .. }
        | AuthConfig::Ntlm { .. } => {}
    }

    (target, message, metadata)
}
