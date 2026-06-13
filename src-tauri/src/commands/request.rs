use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;
use voleeo_core::{
    ApiFolder, AuthConfig, EnvironmentVariable, HttpRequest, MoveItemUpdate, RequestBody,
    RequestParameter, VoleeoError,
};
use voleeo_crypto as workspace_key;
use voleeo_storage::{RequestStore, WorkspaceStore};

/// `Decrypt`: file → wire (ciphertext → plaintext). `Encrypt`: wire → file.
pub(crate) enum Direction {
    Decrypt,
    Encrypt,
}

/// Cloneable bundle of the stores + path the request commands (and the git
/// entity-decrypt helpers) touch. Cloned once at the command boundary then moved
/// into a single `spawn_blocking` so the YAML + keyring round-trip never stalls
/// the async runtime (CLAUDE.md rule #17).
#[derive(Clone)]
pub(crate) struct Stores {
    pub requests: RequestStore,
    pub workspaces: WorkspaceStore,
    pub app_data_dir: PathBuf,
}

impl Stores {
    pub(crate) fn from(state: &AppState) -> Self {
        Self {
            requests: state.requests.clone(),
            workspaces: state.workspaces.clone(),
            app_data_dir: state.app_data_dir.clone(),
        }
    }
}

/// Bridge sync work into the tokio runtime. Any closure that touches YAML, the
/// keyring, or AES round-trips goes through here so we never block the async
/// executor (CLAUDE.md rule #17).
pub(crate) async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, VoleeoError> + Send + 'static,
) -> Result<T, VoleeoError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Encrypt/decrypt every secret field an auth scheme declares (Bearer token,
/// Basic password, API-key value, SigV4 secret-key + session-token, …) with the
/// workspace key. New schemes are covered automatically by declaring their
/// secrets in `AuthConfig::secret_fields_mut`. Mirrors
/// `environment.rs::transform_secrets`.
pub(crate) fn transform_auth_secrets(
    auth: &mut AuthConfig,
    workspace_id: &str,
    stores: &Stores,
    direction: Direction,
) -> Result<(), VoleeoError> {
    let mut fields = auth.secret_fields_mut();
    if fields.iter().all(|(_, encrypted)| !encrypted) {
        return Ok(());
    }
    // workspace.yaml can be unparseable mid-merge (conflict markers); we only
    // get here because a secret is flagged encrypted, which implies an encrypted
    // workspace — so assume that rather than failing the whole parse/conflict load.
    let encrypted = stores
        .workspaces
        .get(workspace_id)
        .map(|ws| ws.encrypted)
        .unwrap_or(true);
    if !encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = workspace_key::load_key(workspace_id, &stores.app_data_dir)?;
    for (secret, _) in fields.iter_mut().filter(|(_, e)| *e) {
        match direction {
            Direction::Decrypt => {
                // Skip if already plaintext (encryption toggled on but never saved).
                if workspace_key::is_encrypted(secret) {
                    **secret = workspace_key::decrypt(secret, &key)?;
                }
            }
            Direction::Encrypt => {
                if !workspace_key::is_encrypted(secret) {
                    **secret = workspace_key::encrypt(secret, &key)?;
                }
            }
        }
    }
    Ok(())
}

/// Encrypt/decrypt the `encrypted` folder variables in place using the
/// workspace key. Mirrors `transform_auth_secrets` for `EnvironmentVariable`.
pub(crate) fn transform_var_secrets(
    vars: &mut [EnvironmentVariable],
    workspace_id: &str,
    stores: &Stores,
    direction: Direction,
) -> Result<(), VoleeoError> {
    if vars.iter().all(|v| !v.encrypted) {
        return Ok(());
    }
    // workspace.yaml can be unparseable mid-merge (conflict markers); we only
    // get here because a secret is flagged encrypted, which implies an encrypted
    // workspace — so assume that rather than failing the whole parse/conflict load.
    let encrypted = stores
        .workspaces
        .get(workspace_id)
        .map(|ws| ws.encrypted)
        .unwrap_or(true);
    if !encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = workspace_key::load_key(workspace_id, &stores.app_data_dir)?;
    for v in vars.iter_mut().filter(|v| v.encrypted) {
        match direction {
            Direction::Decrypt => {
                if workspace_key::is_encrypted(&v.value) {
                    v.value = workspace_key::decrypt(&v.value, &key)?;
                }
            }
            Direction::Encrypt => {
                if !workspace_key::is_encrypted(&v.value) {
                    v.value = workspace_key::encrypt(&v.value, &key)?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_requests(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<HttpRequest>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut requests = stores.requests.list_requests(&workspace_id)?;
        for req in requests.iter_mut() {
            transform_auth_secrets(&mut req.auth, &workspace_id, &stores, Direction::Decrypt)?;
        }
        Ok(requests)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_folders(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ApiFolder>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut folders = stores.requests.list_folders(&workspace_id)?;
        for f in folders.iter_mut() {
            transform_auth_secrets(&mut f.auth, &workspace_id, &stores, Direction::Decrypt)?;
            transform_var_secrets(&mut f.variables, &workspace_id, &stores, Direction::Decrypt)?;
        }
        Ok(folders)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_request(
    state: State<'_, AppState>,
    workspace_id: String,
    folder_id: Option<String>,
    name: String,
    method: String,
    url: String,
) -> Result<HttpRequest, VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.create_request(workspace_id, folder_id, name, method, url)).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_folder(
    state: State<'_, AppState>,
    workspace_id: String,
    folder_id: Option<String>,
    name: String,
) -> Result<ApiFolder, VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.create_folder(workspace_id, folder_id, name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn duplicate_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<HttpRequest, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut req = stores.requests.duplicate_request(&workspace_id, &id)?;
        transform_auth_secrets(&mut req.auth, &workspace_id, &stores, Direction::Decrypt)?;
        Ok(req)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn duplicate_folder(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<ApiFolder, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut folder = stores.requests.duplicate_folder(&workspace_id, &id)?;
        transform_auth_secrets(&mut folder.auth, &workspace_id, &stores, Direction::Decrypt)?;
        transform_var_secrets(
            &mut folder.variables,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        Ok(folder)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    name: String,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.rename_request(&workspace_id, &id, name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    method: String,
    url: String,
    parameters: Vec<RequestParameter>,
    headers: Vec<RequestParameter>,
    body: Option<RequestBody>,
    auth: AuthConfig,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        // Compare on plaintext before encrypting: re-encrypting a secret uses a
        // fresh nonce, so an unchanged request would otherwise look different and
        // re-save, bumping updatedAt into a phantom git change.
        let mut current = stores.requests.get_request(&workspace_id, &id)?;
        transform_auth_secrets(
            &mut current.auth,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        let mut next = current.clone();
        next.method = method;
        next.url = url;
        next.parameters = parameters;
        next.headers = headers;
        next.body = body;
        next.auth = auth;
        if next == current {
            return Ok(());
        }
        transform_auth_secrets(&mut next.auth, &workspace_id, &stores, Direction::Encrypt)?;
        stores.requests.update_request(
            &workspace_id,
            &id,
            next.method,
            next.url,
            next.parameters,
            next.headers,
            next.body,
            next.auth,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_folder(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    name: String,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.rename_folder(&workspace_id, &id, name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_folder(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    headers: Vec<RequestParameter>,
    auth: AuthConfig,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        // Plaintext comparison before encrypting — see `update_request`.
        let mut current = stores.requests.get_folder(&workspace_id, &id)?;
        transform_auth_secrets(
            &mut current.auth,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        let mut next = current.clone();
        next.headers = headers;
        next.auth = auth;
        if next == current {
            return Ok(());
        }
        transform_auth_secrets(&mut next.auth, &workspace_id, &stores, Direction::Encrypt)?;
        stores
            .requests
            .update_folder(&workspace_id, &id, next.headers, next.auth)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_folder_color(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    color: Option<String>,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.update_folder_color(&workspace_id, &id, color)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_folder_variables(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
    variables: Vec<EnvironmentVariable>,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        // Plaintext comparison before encrypting — see `update_request`.
        let mut current = stores.requests.get_folder(&workspace_id, &id)?;
        transform_var_secrets(
            &mut current.variables,
            &workspace_id,
            &stores,
            Direction::Decrypt,
        )?;
        if variables == current.variables {
            return Ok(());
        }
        let mut variables = variables;
        transform_var_secrets(&mut variables, &workspace_id, &stores, Direction::Encrypt)?;
        stores
            .requests
            .update_folder_variables(&workspace_id, &id, variables)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_request(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.delete_request(&workspace_id, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_folder(
    state: State<'_, AppState>,
    workspace_id: String,
    id: String,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    run_blocking(move || requests.delete_folder_cascade(&workspace_id, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn move_items(
    state: State<'_, AppState>,
    workspace_id: String,
    updates: Vec<MoveItemUpdate>,
) -> Result<(), VoleeoError> {
    let requests = state.requests.clone();
    let ws = state.ws.clone();
    let grpc = state.grpc.clone();
    run_blocking(move || {
        for u in &updates {
            match u.kind {
                voleeo_core::ItemKind::WebSocket => {
                    ws.update_position(&workspace_id, &u.id, u.folder_id.clone(), u.order)?;
                }
                voleeo_core::ItemKind::Grpc => {
                    grpc.update_position(&workspace_id, &u.id, u.folder_id.clone(), u.order)?;
                }
                _ => {}
            }
        }
        requests.move_items(&workspace_id, updates)
    })
    .await
}
