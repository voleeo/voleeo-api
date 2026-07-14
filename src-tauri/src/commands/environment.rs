use std::path::PathBuf;
use tauri::State;
use voleeo_core::{Environment, EnvironmentKind, VoleeoError};
use voleeo_storage::{EnvironmentStore, WorkspaceStore, GLOBAL_ENV_ID};

use crate::commands::request::run_blocking;
use crate::state::AppState;
use voleeo_crypto as workspace_key;

/// Direction of the secret transform — `Decrypt`: file → wire (ciphertext on
/// disk → plaintext in result). `Encrypt`: wire → file.
enum Direction {
    Decrypt,
    Encrypt,
}

/// Cloneable bundle of the stores + path the env commands touch. Cloned once at
/// the command boundary then moved into a single `spawn_blocking` so the YAML +
/// keyring round-trip never stalls the async runtime (CLAUDE.md rule #17).
#[derive(Clone)]
struct Stores {
    environments: EnvironmentStore,
    workspaces: WorkspaceStore,
    app_data_dir: PathBuf,
}

impl Stores {
    fn from(state: &AppState) -> Self {
        Self {
            environments: state.environments.clone(),
            workspaces: state.workspaces.clone(),
            app_data_dir: state.app_data_dir.clone(),
        }
    }
}

/// If `env` has any variables with `encrypted = true`, transform their `value`
/// fields between plaintext and ciphertext using the workspace key.
fn transform_secrets(
    env: &mut Environment,
    stores: &Stores,
    direction: Direction,
) -> Result<(), VoleeoError> {
    if env.variables.iter().all(|v| !v.encrypted) {
        return Ok(());
    }
    // Verify workspace is actually encrypted; we use its key.
    let ws = stores.workspaces.get(&env.workspace_id)?;
    if !ws.encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = workspace_key::load_key(&env.workspace_id, &stores.app_data_dir)?;
    for var in env.variables.iter_mut() {
        if !var.encrypted {
            continue;
        }
        match direction {
            Direction::Decrypt => {
                if workspace_key::is_encrypted(&var.value) {
                    var.value = workspace_key::decrypt(&var.value, &key)?;
                }
                // else: stored value is already plaintext (e.g., var was just toggled
                // to encrypted but never saved). Leave as-is.
            }
            Direction::Encrypt => {
                if !workspace_key::is_encrypted(&var.value) {
                    var.value = workspace_key::encrypt(&var.value, &key)?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn env_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<Environment>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        stores.environments.ensure_global(&workspace_id)?;
        let mut envs = stores.environments.list(&workspace_id)?;
        for env in envs.iter_mut() {
            transform_secrets(env, &stores, Direction::Decrypt)?;
        }
        Ok(envs)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn env_get(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<Option<Environment>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut env = match stores.environments.get(&workspace_id, &id)? {
            Some(env) => env,
            None => return Ok(None),
        };
        transform_secrets(&mut env, &stores, Direction::Decrypt)?;
        Ok(Some(env))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn env_create(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    color: String,
    shared: bool,
) -> Result<Environment, VoleeoError> {
    let environments = state.environments.clone();
    run_blocking(move || environments.create_personal(workspace_id, name, color, shared)).await
}

#[tauri::command]
#[specta::specta]
pub async fn env_update(
    state: State<'_, AppState>,
    env: Environment,
) -> Result<Environment, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        // Skip the write when nothing meaningful changed — re-saving would bump
        // updatedAt and surface as a phantom git change the user can't see. Compare
        // decrypted views: re-encryption uses a fresh nonce, so ciphertext always
        // differs even for identical plaintext.
        if let Some(mut current) = stores.environments.get(&env.workspace_id, &env.id)? {
            transform_secrets(&mut current, &stores, Direction::Decrypt)?;
            let mut incoming = env.clone();
            incoming.updated_at = current.updated_at.clone();
            if incoming == current {
                return Ok(current);
            }
        }
        let mut to_save = env.clone();
        transform_secrets(&mut to_save, &stores, Direction::Encrypt)?;
        to_save.updated_at = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.6f")
            .to_string();
        stores.environments.save(&to_save)?;
        // Return decrypted view.
        let mut result = to_save;
        transform_secrets(&mut result, &stores, Direction::Decrypt)?;
        Ok(result)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn env_delete(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    if id == GLOBAL_ENV_ID {
        return Err(VoleeoError::InvalidConfig(
            "Global Environment cannot be deleted.".to_string(),
        ));
    }
    let environments = state.environments.clone();
    run_blocking(move || {
        // Sanity: if the env doesn't exist we silently succeed (idempotent delete).
        if let Some(env) = environments.get(&workspace_id, &id)? {
            if matches!(env.kind, EnvironmentKind::Global) {
                return Err(VoleeoError::InvalidConfig(
                    "Global Environment cannot be deleted.".to_string(),
                ));
            }
        }
        environments.delete(&workspace_id, &id)
    })
    .await
}

/// Full OS env snapshot for the system-variables allowlist picker. The first
/// call may spawn the user's login shell (see `resolve::system_env`).
#[tauri::command]
#[specta::specta]
pub async fn system_env_list() -> Result<std::collections::HashMap<String, String>, VoleeoError> {
    run_blocking(|| Ok(voleeo_mcp::resolve::system_env_snapshot().clone())).await
}
