use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Emitter, State};
use voleeo_core::{
    AuthConfig, HttpResponse, RequestBody, RequestParameter, SseFrame, StoredCookie, TimelineEvent,
    VoleeoError,
};
use voleeo_http::SseAccum;

use crate::commands::cookie::{
    active_jar_id_for_workspace, ingest_captured_cookies, load_active_jar_for_send,
};
use crate::state::AppState;

// SSE frames are coalesced into batched `sse:frames` emits — one Tauri event per
// ~33 ms (or 256 frames) instead of one per frame. A fast stream (LLM token
// deltas, thousands/s) otherwise floods the IPC channel: the UI can't render that
// fast, the event backlog grows, and even `cancel_request` — which rides the same
// channel — can't get through. The accum still records every frame for history.
const SSE_BATCH_MAX: usize = 256;
const SSE_FLUSH_MS: u128 = 33;

struct SseBatch {
    buf: Vec<(SseFrame, TimelineEvent)>,
    last_flush: Instant,
}

impl SseBatch {
    fn new() -> Self {
        Self {
            buf: Vec::new(),
            last_flush: Instant::now(),
        }
    }
}

// Borrowed so a batch serializes straight to the wire — no intermediate
// `serde_json::Value` tree. `Clone` is required by `emit` and is cheap (the
// fields are references).
#[derive(serde::Serialize, Clone)]
struct SseFrameRow<'a> {
    frame: &'a SseFrame,
    timeline: &'a TimelineEvent,
}

#[derive(serde::Serialize, Clone)]
struct SseFramesPayload<'a> {
    #[serde(rename = "requestId")]
    request_id: &'a str,
    frames: Vec<SseFrameRow<'a>>,
}

/// Flush when the batch is full or the time window has passed since the last
/// emit. Full bounds payload/render cost on a burst; the window keeps a slow
/// stream's latency near-zero (a sparse frame's `elapsed` already exceeds it).
fn sse_should_flush(len: usize, elapsed_ms: u128) -> bool {
    len >= SSE_BATCH_MAX || elapsed_ms >= SSE_FLUSH_MS
}

/// Emit the buffered frames as one `sse:frames` event, then move them into the
/// accum. Lock order is batch→accum — the only place both are held at once.
fn flush_sse_batch(
    app: &AppHandle,
    request_id: &str,
    buf: &mut Vec<(SseFrame, TimelineEvent)>,
    accum: &Arc<Mutex<SseAccum>>,
) {
    if buf.is_empty() {
        return;
    }
    let frames: Vec<SseFrameRow> = buf
        .iter()
        .map(|(frame, timeline)| SseFrameRow { frame, timeline })
        .collect();
    let _ = app.emit("sse:frames", SseFramesPayload { request_id, frames });
    if let Ok(mut a) = accum.lock() {
        for (frame, timeline) in buf.drain(..) {
            a.frame(frame, timeline);
        }
    } else {
        buf.clear();
    }
}

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
    app: AppHandle,
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

    let accum: Arc<Mutex<SseAccum>> = Arc::new(Mutex::new(SseAccum::default()));
    let batch: Arc<Mutex<SseBatch>> = Arc::new(Mutex::new(SseBatch::new()));
    let frame_app = app.clone();
    let frame_rid = request_id.clone();
    let sink_accum = accum.clone();
    let sink_batch = batch.clone();
    let sse_sink: voleeo_http::SseSink = Arc::new(move |ev| match ev {
        voleeo_http::SseEvent::Open {
            status,
            status_text,
            headers,
            events,
            captured_cookies,
            attached_cookies,
        } => {
            let _ = frame_app.emit(
                "sse:open",
                serde_json::json!({
                    "requestId": frame_rid,
                    "status": status,
                    "statusText": &status_text,
                    "headers": &headers,
                    "events": &events,
                }),
            );
            if let Ok(mut a) = sink_accum.lock() {
                a.open(status, status_text, headers, events);
                // Preserve Set-Cookie/sent cookies through a cancel/interrupt rebuild.
                a.set_cookies(captured_cookies, attached_cookies);
            }
            // Measure the first batch's window from stream open, not sink build.
            if let Ok(mut b) = sink_batch.lock() {
                b.last_flush = Instant::now();
            }
        }
        voleeo_http::SseEvent::Frame { frame, timeline } => {
            if let Ok(mut b) = sink_batch.lock() {
                b.buf.push((frame, timeline));
                if sse_should_flush(b.buf.len(), b.last_flush.elapsed().as_millis()) {
                    flush_sse_batch(&frame_app, &frame_rid, &mut b.buf, &sink_accum);
                    b.last_flush = Instant::now();
                }
            }
        }
    });
    // The sink only flushes when a frame arrives. A burst that fills less than a
    // full batch within one window, then a mid-stream quiet gap (the common LLM
    // "burst then think" shape), would otherwise strand those frames until the
    // next frame or stream end — the live view freezes for the gap. A periodic
    // flusher bounds that latency to one window. It no-ops while the sink keeps up
    // (empty buffer or window not yet elapsed) and for non-SSE sends, and is
    // stopped before the tail-flush so it can't race the final drain.
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    let tick_batch = batch.clone();
    let tick_accum = accum.clone();
    let tick_app = app.clone();
    let tick_rid = request_id.clone();
    let ticker = tokio::spawn(async move {
        let mut iv = tokio::time::interval(std::time::Duration::from_millis(SSE_FLUSH_MS as u64));
        iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                _ = iv.tick() => {
                    if let Ok(mut b) = tick_batch.lock() {
                        if !b.buf.is_empty() && b.last_flush.elapsed().as_millis() >= SSE_FLUSH_MS {
                            flush_sse_batch(&tick_app, &tick_rid, &mut b.buf, &tick_accum);
                            b.last_flush = Instant::now();
                        }
                    }
                }
            }
        }
    });

    let send_result = state
        .executor
        .send_streamed(&req, attach_cookies, dns_overrides, sse_sink)
        .await;

    // Stop the ticker and wait for it to exit before draining the tail, so it
    // can't race the final flush. Frames buffered since the last flush would
    // otherwise wait for a frame that never comes (stream ended or was cancelled).
    let _ = stop_tx.send(());
    let _ = ticker.await;
    if let Ok(mut b) = batch.lock() {
        flush_sse_batch(&app, &request_id, &mut b.buf, &accum);
    }
    let take_accum = || {
        accum
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default()
    };
    let mut resp = match send_result {
        Ok(r) => take_accum().finalize(r),
        Err(VoleeoError::Cancelled) => {
            let a = take_accum();
            if !a.is_sse() {
                return Err(VoleeoError::Cancelled);
            }
            a.into_cancelled_response(&request_id)
        }
        Err(e) => {
            let a = take_accum();
            if !a.is_sse() {
                return Err(e);
            }
            let message = match &e {
                VoleeoError::HttpFailed(f) => f.message.clone(),
                other => other.to_string(),
            };
            a.into_interrupted_response(&request_id, message)
        }
    };

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

/// Signed contributions for preview / "Copy as …": header params and/or query
/// params (OAuth 1.0 can place its params in either).
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SignedAuthParts {
    pub headers: Vec<RequestParameter>,
    pub query: Vec<RequestParameter>,
}

/// Sign a dynamic auth scheme (AWS SigV4, OAuth 1.0) over a resolved request and
/// return the headers/query it would add — so preview and "Copy as …" can show
/// the real signature without sending. `auth` must already be resolved (templates
/// expanded, secrets decrypted); static/no auth yields empty lists. Pure, so no
/// app state is touched.
#[tauri::command]
#[specta::specta]
pub async fn sign_auth_headers(
    auth: voleeo_core::AuthConfig,
    method: String,
    url: String,
    body: Option<RequestBody>,
) -> Result<SignedAuthParts, VoleeoError> {
    let (headers, query) = voleeo_http::sign_dynamic_auth_url(&auth, &method, &url, body.as_ref())?;
    let to_params = |pairs: Vec<(String, String)>| {
        pairs
            .into_iter()
            .map(|(name, value)| RequestParameter {
                id: "__auth".into(),
                name,
                value,
                enabled: true,
            })
            .collect()
    };
    Ok(SignedAuthParts {
        headers: to_params(headers),
        query: to_params(query),
    })
}

#[cfg(test)]
mod tests {
    use super::{sse_should_flush, SSE_BATCH_MAX, SSE_FLUSH_MS};

    #[test]
    fn flushes_on_full_batch_or_elapsed_window() {
        assert!(
            !sse_should_flush(1, 0),
            "fresh + nearly empty: hold to coalesce"
        );
        assert!(
            sse_should_flush(SSE_BATCH_MAX, 0),
            "full batch flushes regardless of time"
        );
        assert!(
            sse_should_flush(1, SSE_FLUSH_MS),
            "window elapsed flushes even a single frame (slow stream stays low-latency)"
        );
    }
}
