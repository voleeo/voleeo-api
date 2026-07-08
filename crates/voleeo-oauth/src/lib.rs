//! OAuth 2.0 token manager (Tauri-free): token requests (`flow`), the
//! machine-local token cache (`token_cache`), and the authorization-code
//! loopback (`loopback`). Shared by `src-tauri` (commands + interactive flow)
//! and `voleeo-mcp` (cached-token reuse + non-interactive grants on send).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use voleeo_core::{OAuth2Grant, VoleeoError};

/// Per-(workspace, cache-key) locks so two concurrent sends needing the same
/// token serialize their load→refresh→save instead of racing and clobbering the
/// cache write. Held across `.await` (tokio mutex) inside `ensure_token`.
fn key_lock(workspace_id: &str, cache_key: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let map = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .entry(format!("{workspace_id}\u{0}{cache_key}"))
        .or_default()
        .clone()
}

pub mod flow;
pub mod loopback;
pub mod token_cache;

pub use flow::{OAuth2Config, TokenResult};
pub use token_cache::CachedToken;

/// Load a cached token, offloading the file read so the async runtime isn't
/// blocked.
pub async fn load_cached(
    app_data_dir: &Path,
    workspace_id: &str,
    key: &str,
) -> Result<Option<CachedToken>, VoleeoError> {
    let (app_data, ws, key) = (
        app_data_dir.to_path_buf(),
        workspace_id.to_string(),
        key.to_string(),
    );
    tokio::task::spawn_blocking(move || token_cache::load(&app_data, &ws, &key))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Persist a freshly-acquired token (encrypting secrets when the workspace is),
/// offloading the file write.
pub async fn save_token(
    app_data_dir: &Path,
    workspace_id: &str,
    encrypted: bool,
    key: String,
    result: TokenResult,
) -> Result<CachedToken, VoleeoError> {
    let token = CachedToken::new(
        key,
        result.access_token,
        result.refresh_token,
        result.token_type,
        result.scope,
        result.expires_at,
    );
    let (app_data, ws, stored) = (
        app_data_dir.to_path_buf(),
        workspace_id.to_string(),
        token.clone(),
    );
    tokio::task::spawn_blocking(move || token_cache::save(&app_data, &ws, encrypted, stored))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))??;
    Ok(token)
}

/// A valid access token for `config`: the cached one if live, a refresh if it
/// expired and a refresh token exists, otherwise a fresh fetch for the
/// non-interactive grants. **Authorization Code never fetches here** — it needs
/// a browser, so a missing/expired token without refresh is a hard error (the
/// user must acquire it interactively first). Used by the send paths (Tauri UI
/// and MCP) so both share one token cache.
pub async fn ensure_token(
    app_data_dir: &Path,
    workspace_id: &str,
    encrypted: bool,
    config: &OAuth2Config,
) -> Result<String, VoleeoError> {
    let key = config.cache_key();
    let lock = key_lock(workspace_id, &key);
    let _guard = lock.lock().await;

    let cached = load_cached(app_data_dir, workspace_id, &key).await?;
    let now = chrono::Utc::now().timestamp();
    let client = reqwest::Client::new();

    if let Some(t) = &cached {
        if !t.is_expired(now) {
            return Ok(t.access_token.clone());
        }
        if !t.refresh_token.is_empty() {
            if let Ok(result) = flow::refresh(&client, config, &t.refresh_token).await {
                let token = result.access_token.clone();
                save_token(app_data_dir, workspace_id, encrypted, key, result).await?;
                return Ok(token);
            }
        }
    }

    let result = match config.grant {
        OAuth2Grant::ClientCredentials => flow::fetch_client_credentials(&client, config).await?,
        OAuth2Grant::Password => flow::fetch_password(&client, config).await?,
        OAuth2Grant::AuthorizationCode | OAuth2Grant::Implicit => {
            return Err(VoleeoError::Http(
                "No OAuth2 token — acquire it interactively first".into(),
            ));
        }
    };
    let token = result.access_token.clone();
    save_token(app_data_dir, workspace_id, encrypted, key, result).await?;
    Ok(token)
}
