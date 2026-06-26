//! OAuth 2.0 token commands. The token lives in a machine-local cache; these
//! acquire/refresh/clear it and report status. Static config (endpoints, client
//! id, encrypted secret) stays in the request's `AuthConfig`; the token never
//! enters the synced workspace.

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State};
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
            expires_at: (t.expires_at != 0).then_some(t.expires_at as f64),
            scope: t.scope.clone(),
            token_preview: preview(&t.access_token),
        },
        None => Oauth2TokenStatus {
            has_token: false,
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

/// CSRF state + a bound loopback + the redirect URI for an interactive grant,
/// honoring user-pinned `state`/`redirect_uri` (empty = auto: random state,
/// random loopback port).
async fn interactive_setup(
    config: &OAuth2Config,
) -> Result<(String, Loopback, String), VoleeoError> {
    let csrf = if config.state.trim().is_empty() {
        voleeo_auth::oauth2::gen_state()
    } else {
        config.state.trim().to_string()
    };
    if config.redirect_uri.trim().is_empty() {
        let lb = Loopback::bind().await?;
        let redirect = lb.redirect_uri();
        return Ok((csrf, lb, redirect));
    }
    let uri = config.redirect_uri.trim();
    let lb = Loopback::bind_port(loopback_port(uri)?).await?;
    Ok((csrf, lb, uri.to_string()))
}

/// Port from a `http://127.0.0.1:<port>/...` loopback redirect. The desktop flow
/// can only catch loopback redirects, so anything else is rejected.
fn loopback_port(uri: &str) -> Result<u16, VoleeoError> {
    let host_port = uri
        .split_once("://")
        .map_or(uri, |(_, rest)| rest)
        .split('/')
        .next()
        .unwrap_or("");
    let is_loopback = host_port.starts_with("127.0.0.1:") || host_port.starts_with("localhost:");
    match (is_loopback, host_port.rsplit(':').next().and_then(|p| p.parse().ok())) {
        (true, Some(port)) => Ok(port),
        _ => Err(VoleeoError::InvalidConfig(
            "Redirect URI must be a loopback address with a port, e.g. http://127.0.0.1:8080/callback".into(),
        )),
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

const OAUTH_WINDOW_LABEL: &str = "oauth";

async fn open_auth_page(
    app: &tauri::AppHandle,
    url: &str,
    external: bool,
) -> Result<Option<tauri::WebviewWindow>, VoleeoError> {
    if external {
        open::that(url).map_err(|e| VoleeoError::Http(format!("Failed to open browser: {e}")))?;
        return Ok(None);
    }
    if let Some(w) = app.get_webview_window(OAUTH_WINDOW_LABEL) {
        let _ = w.close();
    }
    let parsed = tauri::Url::parse(url)
        .map_err(|e| VoleeoError::InvalidConfig(format!("Invalid authorization URL: {e}")))?;
    tauri::WebviewWindowBuilder::new(app, OAUTH_WINDOW_LABEL, tauri::WebviewUrl::External(parsed))
        .title("Sign in")
        .incognito(true)
        .inner_size(760.0, 600.0)
        .center()
        .resizable(true)
        .build()
        .map(Some)
        .map_err(|e| VoleeoError::Http(format!("Failed to open sign-in window: {e}")))
}

/// Race a loopback wait against the user closing the sign-in window, so closing
/// it cancels the flow at once instead of hanging until the loopback timeout.
/// Plain await when there's no internal window (external browser) — we can't
/// observe the system browser closing. The `Mutex` guard is never held across an
/// await (taken only inside the sync event callback), so rule 19 holds.
async fn await_or_window_closed<T>(
    window: &Option<tauri::WebviewWindow>,
    wait: impl std::future::Future<Output = Result<T, VoleeoError>>,
) -> Result<T, VoleeoError> {
    let Some(w) = window else {
        return wait.await;
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    let slot = std::sync::Mutex::new(Some(tx));
    w.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            if let Ok(mut guard) = slot.lock() {
                if let Some(tx) = guard.take() {
                    let _ = tx.send(());
                }
            }
        }
    });
    tokio::select! {
        r = wait => r,
        _ = rx => Err(VoleeoError::Http(
            "Sign-in window closed before authorizing".into(),
        )),
    }
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
    let use_external_browser = matches!(
        &auth,
        AuthConfig::OAuth2 {
            use_external_browser: true,
            ..
        }
    );
    // Implicit has no token endpoint; every other grant needs one.
    if config.grant != OAuth2Grant::Implicit && config.token_url.trim().is_empty() {
        return Err(VoleeoError::InvalidConfig(
            "OAuth2 token URL is required".into(),
        ));
    }
    let client = reqwest::Client::new();
    let result = match config.grant {
        OAuth2Grant::ClientCredentials => flow::fetch_client_credentials(&client, &config).await?,
        OAuth2Grant::Password => flow::fetch_password(&client, &config).await?,
        OAuth2Grant::Implicit => {
            if config.auth_url.trim().is_empty() {
                return Err(VoleeoError::InvalidConfig(
                    "OAuth2 authorization URL is required".into(),
                ));
            }
            let (csrf, loopback, redirect) = interactive_setup(&config).await?;
            let url = flow::build_auth_url(&config, &redirect, &csrf, None);
            let window = open_auth_page(&app, &url, use_external_browser).await?;
            let token = await_or_window_closed(
                &window,
                loopback.wait_for_token(&csrf, Duration::from_secs(120)),
            )
            .await;
            if let Some(w) = window {
                let _ = w.close();
            }
            token?
        }
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
            let (csrf, loopback, redirect) = interactive_setup(&config).await?;
            let url = flow::build_auth_url(
                &config,
                &redirect,
                &csrf,
                pkce.as_ref().map(|p| p.challenge.as_str()),
            );
            let window = open_auth_page(&app, &url, use_external_browser).await?;
            let code_result = await_or_window_closed(
                &window,
                loopback.wait_for_code(&csrf, Duration::from_secs(120)),
            )
            .await;
            if let Some(w) = window {
                let _ = w.close();
            }
            let code = code_result?;
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
