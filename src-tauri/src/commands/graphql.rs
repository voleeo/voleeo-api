//! GraphQL schema introspection. GraphQL requests are ordinary HTTP requests
//! with a `BodyKind::Graphql` body, so the only GraphQL-specific backend piece
//! is this: send the caller-supplied introspection query against the request's
//! endpoint (reusing its resolved auth/headers) and return the raw response,
//! WITHOUT touching the response history ring buffer.

use tauri::State;
use voleeo_core::{BodyKind, HttpResponse, RequestBody, VoleeoError};

use crate::commands::request::{run_blocking, transform_auth_secrets, Direction, Stores};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn graphql_introspect(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
    environment_id: Option<String>,
    query: String,
) -> Result<HttpResponse, VoleeoError> {
    let stores = Stores::from(&state);
    let requests = state.requests.clone();
    let environments = state.environments.clone();
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    let ws_id = workspace_id;

    // Resolve env/folder vars + auth + headers backend-side (mirrors the MCP
    // send path) so introspection uses the same wire request a real send would.
    let (req, dns_overrides) = run_blocking(move || {
        let mut req = requests.get_request(&ws_id, &request_id)?;
        transform_auth_secrets(&mut req.auth, &ws_id, &stores, Direction::Decrypt)?;
        req.method = "POST".into();
        req.body = Some(RequestBody {
            kind: BodyKind::Graphql,
            text: query,
            graphql_variables: None,
            ..Default::default()
        });

        let mut vars = voleeo_mcp::resolve::load_env_vars(
            &environments,
            &ws_id,
            environment_id.as_deref(),
            &app_data_dir,
        );
        let folders = requests.list_folders(&ws_id).unwrap_or_default();
        let key = voleeo_crypto::load_key_from_file(&ws_id, &app_data_dir).ok();
        voleeo_mcp::resolve::apply_folder_vars(
            &mut vars,
            req.folder_id.as_deref(),
            &folders,
            key.as_ref(),
        );
        voleeo_mcp::resolve::apply_to_request(&mut req, &vars);
        // Workspace read is sync fs — load DNS overrides here, off the runtime.
        let dns_overrides = workspaces
            .get(&ws_id)
            .map(|w| w.dns_overrides)
            .unwrap_or_default();
        Ok((req, dns_overrides))
    })
    .await?;

    state.executor.send(&req, vec![], dns_overrides).await
}
