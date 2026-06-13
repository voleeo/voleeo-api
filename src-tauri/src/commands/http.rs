use tauri::State;
use voleeo_core::{
    AuthConfig, HttpResponse, RequestBody, RequestParameter, StoredCookie, TimelineEvent,
    VoleeoError,
};

use crate::commands::cookie::{
    active_jar_id_for_workspace, ingest_captured_cookies, load_active_jar_for_send,
};
use crate::state::AppState;

/// Frontend-resolved send-time overrides. Bundled into one struct because
/// `tauri_specta` caps command arity at 10 args. `cookie_overrides` /
/// `auth_override` carry values only JS can resolve (`{{ uuid.v4() }}`, dynamic
/// signing config); when present the backend skips its own resolution for them.
#[derive(Debug, Default, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SendOverrides {
    pub url: Option<String>,
    pub body: Option<RequestBody>,
    pub headers: Option<Vec<RequestParameter>>,
    pub called_from: Option<String>,
    pub resolution_notes: Option<Vec<String>>,
    pub environment_id: Option<String>,
    pub cookie_overrides: Option<Vec<StoredCookie>>,
    pub auth_override: Option<AuthConfig>,
}

#[tauri::command]
#[specta::specta]
pub async fn send_request(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
    overrides: SendOverrides,
) -> Result<HttpResponse, VoleeoError> {
    let SendOverrides {
        url: url_override,
        body: body_override,
        headers: headers_override,
        called_from,
        resolution_notes,
        environment_id,
        cookie_overrides,
        auth_override,
    } = overrides;
    let requests = state.requests.clone();
    let ws_id = workspace_id.clone();
    let req_id = request_id.clone();
    let mut req = tokio::task::spawn_blocking(move || requests.get_request(&ws_id, &req_id))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))??;

    if let Some(url) = url_override {
        req.url = url;
    }

    if let Some(body) = body_override {
        req.body = Some(body);
    }
    if let Some(headers) = headers_override {
        req.headers = headers;
    }
    // The frontend resolves auth: static schemes are already in `headers_override`
    // (so `auth_override` is `none`), dynamic schemes (SigV4) arrive fully
    // resolved here for the executor to sign. The executor only ever acts on
    // `req.auth`, so set it explicitly — `None` when no override (e.g. chained
    // builtin resends, which carry no resolved auth).
    req.auth = auth_override.unwrap_or(AuthConfig::None);

    // Key load is sync I/O → spawn_blocking. Best-effort: unencrypted
    // workspaces have no key, so any `enc:v1:` prefix passes through to the
    // wire as a visibly-broken value rather than a silent decrypt error.
    let app_data_dir = state.app_data_dir.clone();
    let ws_for_resolve = workspace_id.clone();

    let (active_jar_id, attach_cookies) = if let Some(overrides) = cookie_overrides {
        let jar_id = active_jar_id_for_workspace(&state, &workspace_id).await?;
        let decrypted = tokio::task::spawn_blocking(move || {
            let key = voleeo_crypto::load_key_from_file(&ws_for_resolve, &app_data_dir).ok();
            let mut cs = overrides;
            voleeo_cookies::resolve::decrypt_cookies(&mut cs, key.as_ref());
            cs
        })
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        (jar_id, decrypted)
    } else {
        let (jar_id, attach) = load_active_jar_for_send(&state, &workspace_id).await?;
        let envs_store = state.environments.clone();
        let env_for_resolve = environment_id.clone();
        let resolved = tokio::task::spawn_blocking(move || {
            let vars = voleeo_mcp::resolve::load_env_vars(
                &envs_store,
                &ws_for_resolve,
                env_for_resolve.as_deref(),
                &app_data_dir,
            );
            let key = voleeo_crypto::load_key_from_file(&ws_for_resolve, &app_data_dir).ok();
            let mut cs = attach;
            voleeo_cookies::resolve::resolve_cookies(&mut cs, &vars, key.as_ref());
            cs
        })
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        (jar_id, resolved)
    };

    // DNS overrides come from the workspace; empty list = system DNS only.
    // Workspace read is sync fs — keep it off the async runtime.
    let workspaces = state.workspaces.clone();
    let ws_for_dns = workspace_id.clone();
    let dns_overrides = tokio::task::spawn_blocking(move || {
        workspaces
            .get(&ws_for_dns)
            .map(|w| w.dns_overrides)
            .unwrap_or_default()
    })
    .await
    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    let mut resp = state
        .executor
        .send(&req, attach_cookies, dns_overrides)
        .await?;

    if !resp.captured_cookies.is_empty() {
        if let Err(e) = ingest_captured_cookies(
            &state,
            &workspace_id,
            &active_jar_id,
            &resp.captured_cookies,
        )
        .await
        {
            eprintln!("[http] failed to ingest captured cookies: {e}");
        }
    }

    if let Some(caller) = called_from {
        resp.events.insert(
            0,
            TimelineEvent {
                at_ms: 0.0,
                kind: "info".into(),
                text: format!("Called from: {}", caller),
            },
        );
    }
    if let Some(notes) = resolution_notes {
        for (i, note) in notes.into_iter().enumerate() {
            resp.events.insert(
                i,
                TimelineEvent {
                    at_ms: 0.0,
                    kind: "resolve".into(),
                    text: note,
                },
            );
        }
    }

    // Persist, then return the STORED response: large text bodies are slimmed
    // out of line there, so a 20 MB payload never crosses IPC. Clone first so a
    // storage failure can still fall back to the full in-memory response.
    let limit = 20_usize;
    let responses = state.responses.clone();
    let ws = workspace_id.clone();
    let rid = request_id.clone();
    let to_store = resp.clone();
    let stored = tokio::task::spawn_blocking(move || responses.append(&ws, &rid, to_store, limit))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    match stored {
        Ok(s) => Ok(s.response),
        Err(e) => {
            eprintln!("[http] failed to store response history: {e}");
            Ok(resp)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_request(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), VoleeoError> {
    state.executor.cancel(&request_id);
    Ok(())
}

/// Sign a dynamic auth scheme (AWS SigV4) over a resolved request and return the
/// headers it would add — so preview and "Copy as …" can show the real
/// signature without sending. `auth` must already be resolved (templates
/// expanded, secrets decrypted); static/no auth yields an empty list. Pure, so
/// no app state is touched.
#[tauri::command]
#[specta::specta]
pub async fn sign_auth_headers(
    auth: voleeo_core::AuthConfig,
    method: String,
    url: String,
    body: Option<RequestBody>,
) -> Result<Vec<RequestParameter>, VoleeoError> {
    let headers = voleeo_http::sign_dynamic_auth_url(&auth, &method, &url, body.as_ref())?;
    Ok(headers
        .into_iter()
        .map(|(name, value)| RequestParameter {
            id: "__auth".into(),
            name,
            value,
            enabled: true,
        })
        .collect())
}
