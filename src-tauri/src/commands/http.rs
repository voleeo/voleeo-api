use tauri::State;
use voleeo_core::{
    HttpResponse, RequestBody, RequestParameter, StoredCookie, TimelineEvent, VoleeoError,
};

use crate::commands::cookie::{
    active_jar_id_for_workspace, ingest_captured_cookies, load_active_jar_for_send,
};
use crate::state::AppState;

/// `cookie_overrides`: frontend-resolved cookies (functions only JS can run,
/// e.g. `{{ uuid.v4() }}`). When `Some`, skip the backend's jar-load pass.
#[tauri::command]
#[specta::specta]
pub async fn send_request(
    state: State<'_, AppState>,
    workspace_id: String,
    request_id: String,
    url_override: Option<String>,
    body_override: Option<RequestBody>,
    headers_override: Option<Vec<RequestParameter>>,
    called_from: Option<String>,
    resolution_notes: Option<Vec<String>>,
    environment_id: Option<String>,
    cookie_overrides: Option<Vec<StoredCookie>>,
) -> Result<HttpResponse, VoleeoError> {
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
