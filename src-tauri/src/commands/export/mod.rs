//! Export workspaces to the native Voleeo Bundle (one lossless YAML) or a portable
//! Postman v2.1 collection (combined, one file plus companion .proto/AsyncAPI
//! files). Loads each workspace, decrypts every secret with the workspace key
//! (so values land as plain text — the user acknowledges this in the UI),
//! serializes via `voleeo-export`, and writes the file(s).

mod reflection;
mod secrets;
mod write;

use tauri::State;
use voleeo_core::VoleeoError;
use voleeo_export::Bundle;
use voleeo_storage::{EnvironmentStore, GrpcStore, RequestStore, WorkspaceStore, WsStore};

use crate::commands::request::{
    run_blocking, transform_auth_secrets, transform_var_secrets, Direction, Stores,
};
use crate::state::AppState;

/// Per-workspace counts the Export picker renders.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportTarget {
    pub id: String,
    pub name: String,
    /// HTTP + WebSocket + gRPC requests.
    pub requests: u32,
    /// WebSocket connections (drive the AsyncAPI section).
    pub ws_count: u32,
    /// gRPC requests (drive the .proto section).
    pub grpc_count: u32,
    pub shared_envs: u32,
    pub private_envs: u32,
    pub shared_secrets: u32,
    pub private_secrets: u32,
    /// Inline `encrypt()` secret chips in non-env fields (URLs, params, headers,
    /// bodies) — always exported, so always counted toward the warning.
    pub inline_secrets: u32,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    /// Absolute path(s) written.
    pub paths: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(serde::Deserialize, specta::Type, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    /// Native, lossless: one self-contained YAML re-importable into Voleeo.
    Voleeo,
    /// Portable Postman Collection v2.1 (+ companion files).
    Postman,
}

/// Everything the export commands touch, cloned once at the boundary then moved
/// into a single `spawn_blocking` (CLAUDE.md rule #17).
#[derive(Clone)]
struct ExportStores {
    base: Stores,
    requests: RequestStore,
    environments: EnvironmentStore,
    ws: WsStore,
    grpc: GrpcStore,
    workspaces: WorkspaceStore,
}

impl ExportStores {
    fn from(state: &AppState) -> Self {
        Self {
            base: Stores::from(state),
            requests: state.requests.clone(),
            environments: state.environments.clone(),
            ws: state.ws.clone(),
            grpc: state.grpc.clone(),
            workspaces: state.workspaces.clone(),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn export_summary(state: State<'_, AppState>) -> Result<Vec<ExportTarget>, VoleeoError> {
    let s = ExportStores::from(&state);
    run_blocking(move || {
        let mut out = Vec::new();
        for ws in s.workspaces.list()? {
            let requests = s.requests.list_requests(&ws.id)?;
            let folders = s.requests.list_folders(&ws.id)?;
            let connections = s.ws.list(&ws.id)?;
            let grpc = s.grpc.list(&ws.id)?;
            let request_count = requests.len() + connections.len() + grpc.len();
            let inline_secrets =
                secrets::non_env_inline_count(&ws, &folders, &requests, &connections, &grpc);

            let (mut shared_envs, mut private_envs) = (0u32, 0u32);
            let (mut shared_secrets, mut private_secrets) = (0u32, 0u32);
            for env in s.environments.list(&ws.id)? {
                // Encrypted-flag vars + inline chips embedded in plain var values.
                let n = env.variables.iter().filter(|v| v.encrypted).count() as u32
                    + secrets::vars_inline_count(&env.variables);
                if env.shared {
                    shared_envs += 1;
                    shared_secrets += n;
                } else {
                    private_envs += 1;
                    private_secrets += n;
                }
            }
            out.push(ExportTarget {
                id: ws.id,
                name: ws.name,
                requests: request_count as u32,
                ws_count: connections.len() as u32,
                grpc_count: grpc.len() as u32,
                shared_envs,
                private_envs,
                shared_secrets,
                private_secrets,
                inline_secrets,
            });
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn export_workspaces(
    state: State<'_, AppState>,
    workspace_ids: Vec<String>,
    format: ExportFormat,
    include_environments: bool,
    include_private: bool,
    export_proto: bool,
    export_asyncapi: bool,
    dest: String,
) -> Result<ExportOutcome, VoleeoError> {
    if workspace_ids.is_empty() {
        return Err(VoleeoError::InvalidConfig("no_workspaces_selected".into()));
    }
    // The Voleeo Bundle is a complete snapshot — always include everything; the
    // env/proto/asyncapi toggles only apply to the Postman path.
    let voleeo = matches!(format, ExportFormat::Voleeo);
    let inc_env = voleeo || include_environments;
    let inc_priv = voleeo || include_private;

    // Phase 1 — load + decrypt the bundles (off-runtime).
    let s = ExportStores::from(&state);
    let bundles = run_blocking(move || {
        workspace_ids
            .iter()
            .map(|id| load_bundle(&s, id, inc_env, inc_priv, true))
            .collect::<Result<Vec<_>, _>>()
    })
    .await?;

    // Phase 2 — for Postman, fetch reflection-based gRPC schemas from the live
    // server and render them to `.proto` (network; not allowed in spawn_blocking).
    let (reflection_protos, reflection_failed) = if !voleeo && export_proto {
        reflection::resolve_reflection_protos(&state.grpc_descriptors, &bundles).await
    } else {
        (Vec::new(), 0)
    };

    // Phase 3 — write everything (off-runtime).
    run_blocking(move || {
        let (mut paths, mut warnings) = write::write_output(format, &bundles, &dest)?;
        if !voleeo {
            write::write_companions(
                &bundles,
                &dest,
                export_proto,
                export_asyncapi,
                &reflection_protos,
                &mut paths,
            )?;
            if reflection_failed > 0 {
                warnings.push(format!(
                    "{reflection_failed} gRPC request(s) couldn't be reached for server reflection, so no .proto was exported for them. Connect to the server (or attach a local .proto) and re-export."
                ));
            }
        }
        Ok(ExportOutcome {
            paths: paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            warnings: dedupe(warnings),
        })
    })
    .await
}

/// The notes the real export would attach, computed up front so the window can
/// show them before the user commits. Skips decryption (warnings don't depend on
/// secret values) and writes nothing.
#[tauri::command]
#[specta::specta]
pub async fn export_preview(
    state: State<'_, AppState>,
    workspace_ids: Vec<String>,
    format: ExportFormat,
    include_environments: bool,
    include_private: bool,
    export_proto: bool,
) -> Result<Vec<String>, VoleeoError> {
    // Voleeo Bundle is lossless → no notes. Postman has collection + companion notes.
    if workspace_ids.is_empty() || matches!(format, ExportFormat::Voleeo) {
        return Ok(Vec::new());
    }
    let s = ExportStores::from(&state);
    run_blocking(move || {
        let bundles = workspace_ids
            .iter()
            .map(|id| load_bundle(&s, id, include_environments, include_private, false))
            .collect::<Result<Vec<_>, _>>()?;
        let mut warnings = voleeo_export::to_postman(&bundles)?.warnings;
        warnings.extend(write::companion_notes(&bundles, export_proto));
        Ok(dedupe(warnings))
    })
    .await
}

/// Load one workspace, optionally decrypting every secret in place. The preview
/// path skips decryption — warnings depend on structure (which protocols/auth/
/// env vars exist), not on secret values, so it avoids the keychain/AES work.
/// The `transform_*` helpers no-op on unencrypted workspaces, so they're safe to
/// call unconditionally when `decrypt` — same as `list_requests`.
fn load_bundle(
    s: &ExportStores,
    id: &str,
    include_environments: bool,
    include_private: bool,
    decrypt: bool,
) -> Result<Bundle, VoleeoError> {
    let mut workspace = s.workspaces.get(id)?;
    let mut folders = s.requests.list_folders(id)?;
    let mut requests = s.requests.list_requests(id)?;
    let mut ws = s.ws.list(id)?;
    let mut grpc = s.grpc.list(id)?;
    let mut environments = if include_environments {
        let mut envs = s.environments.list(id)?;
        if !include_private {
            envs.retain(|e| e.shared);
        }
        envs
    } else {
        Vec::new()
    };

    if decrypt {
        transform_auth_secrets(&mut workspace.auth, id, &s.base, Direction::Decrypt)?;
        for f in &mut folders {
            transform_auth_secrets(&mut f.auth, id, &s.base, Direction::Decrypt)?;
            transform_var_secrets(&mut f.variables, id, &s.base, Direction::Decrypt)?;
        }
        for r in &mut requests {
            transform_auth_secrets(&mut r.auth, id, &s.base, Direction::Decrypt)?;
        }
        for w in &mut ws {
            transform_auth_secrets(&mut w.auth, id, &s.base, Direction::Decrypt)?;
        }
        for g in &mut grpc {
            transform_auth_secrets(&mut g.auth, id, &s.base, Direction::Decrypt)?;
        }
        for env in &mut environments {
            transform_var_secrets(&mut env.variables, id, &s.base, Direction::Decrypt)?;
        }
    }

    let mut bundle = Bundle {
        workspace,
        folders,
        requests,
        ws,
        grpc,
        environments,
    };

    // Inline `{{ encrypt(value="…") }}` chips can live in ANY text field, not just
    // the dedicated secret fields — flatten them too. They only exist on encrypted
    // workspaces (the `encrypt()` template fn requires encryption enabled).
    if decrypt && bundle.workspace.encrypted {
        let key = voleeo_crypto::load_key(id, &s.base.app_data_dir)?;
        secrets::sweep_inline(&mut bundle, &key);
    }

    Ok(bundle)
}

fn dedupe(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(|w| seen.insert(w.clone()))
        .collect()
}
