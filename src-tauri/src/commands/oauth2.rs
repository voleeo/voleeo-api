//! OAuth 2.0 token commands. The token lives in a machine-local cache; these
//! acquire/refresh/clear it and report status. Static config (endpoints, client
//! id, encrypted secret) stays in the request's `AuthConfig`; the token never
//! enters the synced workspace.

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, State};
use voleeo_core::{AuthConfig, OAuth2Grant, OAuth2PkceMethod, VoleeoError};

use voleeo_oauth::flow::{self, OAuth2Config};
use voleeo_oauth::loopback::Loopback;
use voleeo_oauth::token_cache::{self, CachedToken};

use crate::state::AppState;

/// Token state for the Auth-tab panel. Secrets are previewed, never returned.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Oauth2TokenStatus {
    pub has_token: bool,
    /// Whether a refresh token is cached. Client-credentials never issues one, so
    /// the Auth-tab panel hides its Refresh button when this is false.
    pub has_refresh_token: bool,
    /// Unix seconds; `None` = no token or no expiry. `f64` (not `i64`) because
    /// specta forbids exporting BigInt-style types — lossless for real dates.
    pub expires_at: Option<f64>,
    pub scope: String,
    pub token_preview: String,
}

fn status_of(token: Option<&CachedToken>) -> Oauth2TokenStatus {
    match token {
        Some(t) => Oauth2TokenStatus {
            has_token: true,
            has_refresh_token: !t.refresh_token.is_empty(),
            expires_at: (t.expires_at != 0).then_some(t.expires_at as f64),
            scope: t.scope.clone(),
            token_preview: preview(&t.access_token),
        },
        None => Oauth2TokenStatus {
            has_token: false,
            has_refresh_token: false,
            expires_at: None,
            scope: String::new(),
            token_preview: String::new(),
        },
    }
}

fn preview(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() <= 10 {
        "•".repeat(chars.len().max(4))
    } else {
        let head: String = chars[..4].iter().collect();
        let tail: String = chars[chars.len() - 4..].iter().collect();
        format!("{head}…{tail}")
    }
}

fn config_of(auth: &AuthConfig) -> Result<OAuth2Config, VoleeoError> {
    OAuth2Config::from_auth(auth)
        .ok_or_else(|| VoleeoError::InvalidConfig("not an OAuth2 auth config".into()))
}

fn ws_encrypted(state: &AppState, workspace_id: &str) -> bool {
    state
        .workspaces
        .get(workspace_id)
        .map(|w| w.encrypted)
        .unwrap_or(false)
}

/// Persist a freshly-acquired token, then report its status.
async fn store_and_status(
    state: &AppState,
    workspace_id: &str,
    key: String,
    result: flow::TokenResult,
) -> Result<Oauth2TokenStatus, VoleeoError> {
    let encrypted = ws_encrypted(state, workspace_id);
    let token =
        voleeo_oauth::save_token(&state.app_data_dir, workspace_id, encrypted, key, result).await?;
    Ok(status_of(Some(&token)))
}

async fn load_cached(
    state: &AppState,
    workspace_id: &str,
    key: &str,
) -> Result<Option<CachedToken>, VoleeoError> {
    voleeo_oauth::load_cached(&state.app_data_dir, workspace_id, key).await
}

#[tauri::command]
#[specta::specta]
pub async fn oauth2_token_status(
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<Oauth2TokenStatus, VoleeoError> {
    let config = config_of(&auth)?;
    let cached = load_cached(&state, &workspace_id, &config.cache_key()).await?;
    Ok(status_of(cached.as_ref()))
}

/// The cached token's full fields, for the Auth-tab's expandable token view.
/// Returns the raw access token (unmasked) so the user can copy it — only
/// reached when they explicitly expand the panel. `None` when no token cached.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Oauth2TokenDetails {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_at: Option<f64>,
    pub refresh_token: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn oauth2_token_details(
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<Option<Oauth2TokenDetails>, VoleeoError> {
    let config = config_of(&auth)?;
    let cached = load_cached(&state, &workspace_id, &config.cache_key()).await?;
    Ok(cached.map(|t| Oauth2TokenDetails {
        access_token: t.access_token,
        token_type: t.token_type,
        scope: t.scope,
        expires_at: (t.expires_at != 0).then_some(t.expires_at as f64),
        refresh_token: (!t.refresh_token.is_empty()).then_some(t.refresh_token),
    }))
}

/// Acquire a token per the grant type: a direct POST for client-credentials /
/// password, or the interactive browser + loopback flow for authorization-code.
#[tauri::command]
#[specta::specta]
pub async fn oauth2_fetch_token(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<Oauth2TokenStatus, VoleeoError> {
    let config = config_of(&auth)?;
    if config.token_url.trim().is_empty() {
        return Err(VoleeoError::InvalidConfig(
            "OAuth2 token URL is required".into(),
        ));
    }
    let client = reqwest::Client::new();
    let result = match config.grant {
        OAuth2Grant::ClientCredentials => flow::fetch_client_credentials(&client, &config).await?,
        OAuth2Grant::Password => flow::fetch_password(&client, &config).await?,
        OAuth2Grant::AuthorizationCode => {
            if config.auth_url.trim().is_empty() {
                return Err(VoleeoError::InvalidConfig(
                    "OAuth2 authorization URL is required".into(),
                ));
            }
            // Build the PKCE pair: use the supplied verifier (advanced/debug) or a
            // fresh one, then derive the challenge by the chosen method.
            let pkce = config.use_pkce.then(|| {
                let verifier = if config.code_verifier.trim().is_empty() {
                    voleeo_auth::oauth2::gen_verifier()
                } else {
                    config.code_verifier.trim().to_string()
                };
                let challenge = match config.code_challenge_method {
                    OAuth2PkceMethod::Plain => verifier.clone(),
                    OAuth2PkceMethod::S256 => voleeo_auth::oauth2::pkce_challenge(&verifier),
                };
                voleeo_auth::oauth2::Pkce {
                    verifier,
                    challenge,
                }
            });
            let csrf = voleeo_auth::oauth2::gen_state();
            let loopback = Loopback::bind().await?;
            let redirect = loopback.redirect_uri();
            let url = flow::build_auth_url(
                &config,
                &redirect,
                &csrf,
                pkce.as_ref().map(|p| p.challenge.as_str()),
            );
            open::that(&url)
                .map_err(|e| VoleeoError::Http(format!("Failed to open browser: {e}")))?;
            let code = loopback
                .wait_for_code(&csrf, Duration::from_secs(120))
                .await?;
            let verifier = pkce.as_ref().map(|p| p.verifier.as_str()).unwrap_or("");
            flow::exchange_code(&client, &config, code, verifier, &redirect).await?
        }
    };
    let status = store_and_status(&state, &workspace_id, config.cache_key(), result).await?;
    app.emit("oauth2:token-acquired", config.cache_key()).ok();
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn oauth2_refresh_token(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<Oauth2TokenStatus, VoleeoError> {
    let config = config_of(&auth)?;
    let key = config.cache_key();
    let cached = load_cached(&state, &workspace_id, &key).await?;
    let refresh_token = cached
        .as_ref()
        .map(|t| t.refresh_token.clone())
        .filter(|r| !r.is_empty())
        .ok_or_else(|| VoleeoError::Http("No refresh token available".into()))?;
    let client = reqwest::Client::new();
    let result = flow::refresh(&client, &config, &refresh_token).await?;
    let status = store_and_status(&state, &workspace_id, key.clone(), result).await?;
    app.emit("oauth2:token-acquired", key).ok();
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn oauth2_clear_token(
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<(), VoleeoError> {
    let key = config_of(&auth)?.cache_key();
    let app_data = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || token_cache::clear(&app_data, &workspace_id, &key))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

/// Send-path: return a valid access token, refreshing or (for non-interactive
/// grants) fetching as needed. Authorization-code with no cached token errors —
/// the user must click Get Token first. Delegates to `voleeo_oauth::ensure_token`
/// so the Tauri UI and the MCP send path share one cache + acquisition logic.
#[tauri::command]
#[specta::specta]
pub async fn oauth2_ensure_token(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    auth: AuthConfig,
) -> Result<String, VoleeoError> {
    let config = config_of(&auth)?;
    let key = config.cache_key();
    let encrypted = ws_encrypted(&state, &workspace_id);
    let token =
        voleeo_oauth::ensure_token(&state.app_data_dir, &workspace_id, encrypted, &config).await?;
    // Mirror the manual fetch/refresh path so the Auth-tab panel updates after a
    // send auto-acquires a token (otherwise it stays stuck on "No token").
    app.emit("oauth2:token-acquired", key).ok();
    Ok(token)
}
