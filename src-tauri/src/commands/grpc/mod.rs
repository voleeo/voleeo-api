//! gRPC commands: CRUD (`crud`), schema introspection via reflection/`.proto`
//! (`introspect`), and unary execution (`call`). Streaming commands are added
//! with `GrpcManager` in a later phase. Mirrors the `request`/`websocket`
//! command split.

pub mod call;
pub mod crud;
pub mod introspect;
pub mod stream;

use crate::commands::request::run_blocking;
use crate::state::AppState;
use std::sync::Arc;
use voleeo_core::GrpcRequest;
use voleeo_grpc::ResolvedDescriptors;

/// Load a gRPC request and resolve its descriptor pool (cached unless `force`).
/// `{{ VAR }}` tokens in the target are resolved against the environment first
/// (reflection connects to the real host). The descriptor build runs on the
/// async runtime — reflection is network I/O, and the `.proto` compile branch
/// offloads its own file reads inside the crate.
async fn load_and_resolve(
    state: &AppState,
    workspace_id: String,
    id: String,
    environment_id: Option<String>,
    force: bool,
) -> Result<(GrpcRequest, Arc<ResolvedDescriptors>), voleeo_core::VoleeoError> {
    let grpc = state.grpc.clone();
    let environments = state.environments.clone();
    let requests = state.requests.clone();
    let app_data_dir = state.app_data_dir.clone();
    let (ws, gid, env_id) = (workspace_id, id.clone(), environment_id);

    let (req, target) = run_blocking(move || {
        let req = grpc.get(&ws, &gid)?;
        let vars = voleeo_mcp::resolve::grpc_vars(
            &ws,
            req.folder_id.as_deref(),
            env_id.as_deref(),
            &environments,
            &requests,
            &app_data_dir,
        );
        let target = voleeo_mcp::resolve::resolve_str(&req.target, &vars);
        Ok::<_, voleeo_core::VoleeoError>((req, target))
    })
    .await?;

    let cache = state.grpc_descriptors.clone();
    let resolved = if force {
        cache
            .rebuild(&id, &req.proto_source, &target, req.tls)
            .await?
    } else {
        cache
            .get_or_build(&id, &req.proto_source, &target, req.tls)
            .await?
    };
    Ok((req, resolved))
}
