use super::super::{redact, ApiBackend};
use crate::{protocol::ToolResult, resolve};
use serde_json::Value;
use std::path::Path;
use voleeo_core::{
    AuthConfig, BodyField, BodyKind, EnvironmentKind, RequestBody, RequestParameter, StoredCookie,
    VoleeoError,
};
use voleeo_storage::{CookieJarStore, WorkspaceStore};

/// Parse a `headers`/`queryParams` arg into `RequestParameter`s. Accepts an
/// object map `{ "Name": "value" }` (the common case) or an array of
/// `{ name, value, enabled? }` (for duplicate names or disabled rows).
pub(super) fn parse_params(v: &Value) -> Vec<RequestParameter> {
    let mk = |name: String, value: String, enabled: bool| RequestParameter {
        id: format!("p_{}", voleeo_core::new_id()),
        name,
        value,
        enabled,
    };
    match v {
        Value::Object(map) => map
            .iter()
            .filter_map(|(k, val)| val.as_str().map(|s| mk(k.clone(), s.to_string(), true)))
            .collect(),
        Value::Array(arr) => arr
            .iter()
            .filter_map(|item| {
                let name = item["name"].as_str()?;
                Some(mk(
                    name.to_string(),
                    item["value"].as_str().unwrap_or("").to_string(),
                    item["enabled"].as_bool().unwrap_or(true),
                ))
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Parse a `body` arg into a `RequestBody`. `Ok(None)` = no body arg given.
/// Supports raw kinds (json/xml/text/html via `text`) and form-urlencoded (via
/// a `fields` object map). Multipart / binary file uploads are intentionally
/// unsupported over MCP (they'd read arbitrary local files); GraphQL bodies go
/// through `graphqlQuery`.
pub(super) fn parse_body(v: &Value) -> Result<Option<RequestBody>, String> {
    if v.is_null() {
        return Ok(None);
    }
    let kind_str = v["kind"]
        .as_str()
        .ok_or("body.kind is required (json, xml, text, html, form_url_encoded, none)")?;
    let kind = match kind_str.to_ascii_lowercase().as_str() {
        "json" => BodyKind::Json,
        "xml" => BodyKind::Xml,
        "text" => BodyKind::Text,
        "html" => BodyKind::Html,
        "form_url_encoded" | "form" => BodyKind::FormUrlEncoded,
        "none" => BodyKind::None,
        other => {
            return Err(format!(
                "unsupported body kind {other:?} — use json, xml, text, html, form_url_encoded, \
                 or none (for GraphQL use graphqlQuery; multipart/binary uploads aren't supported)"
            ))
        }
    };
    let fields = if matches!(kind, BodyKind::FormUrlEncoded) {
        v["fields"].as_object().map(|m| {
            m.iter()
                .filter_map(|(k, val)| {
                    val.as_str().map(|s| BodyField {
                        id: format!("f_{}", voleeo_core::new_id()),
                        name: k.clone(),
                        value: s.to_string(),
                        enabled: true,
                        is_file: false,
                        content_type: None,
                    })
                })
                .collect()
        })
    } else {
        None
    };
    Ok(Some(RequestBody {
        kind,
        text: v["text"].as_str().unwrap_or("").to_string(),
        fields,
        content_type: v["contentType"].as_str().map(str::to_string),
        ..Default::default()
    }))
}

/// Decrypt → upsert captured cookies by RFC 6265 identity → re-encrypt → save.
/// Mirrors the Tauri `ingest_captured_cookies` so MCP and IPC captures match.
fn ingest_captured_blocking(
    workspaces: &WorkspaceStore,
    cookies_store: &CookieJarStore,
    app_data_dir: &Path,
    workspace_id: &str,
    jar_id: &str,
    captured: &[StoredCookie],
) -> Result<(), VoleeoError> {
    if captured.is_empty() {
        return Ok(());
    }
    let ws = workspaces.get(workspace_id)?;
    let mut jar = cookies_store.get(workspace_id, jar_id)?;

    // Need the key to decrypt existing cookies, or to encrypt newly captured
    // ones on save when ws.encrypted (even if the jar is currently plaintext).
    let needs_key = voleeo_cookies::crypto::jar_needs_key(&jar.cookies) || ws.encrypted;
    let key = if needs_key {
        if !ws.encrypted {
            return Err(VoleeoError::InvalidConfig(
                "workspace_encryption_required".to_string(),
            ));
        }
        Some(voleeo_crypto::load_key(workspace_id, app_data_dir)?)
    } else {
        None
    };
    if let Some(ref k) = key {
        voleeo_cookies::crypto::decrypt_values(&mut jar.cookies, k)?;
    }

    for fresh in captured {
        let pos = jar
            .cookies
            .iter()
            .position(|c| voleeo_cookies::matching::same_identity(c, fresh));
        let mut entry = fresh.clone();
        entry.value_encrypted = ws.encrypted;
        if let Some(idx) = pos {
            entry.id = jar.cookies[idx].id.clone();
            entry.created_at = jar.cookies[idx].created_at.clone();
            jar.cookies[idx] = entry;
        } else {
            jar.cookies.push(entry);
        }
    }
    jar.updated_at = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string();
    if let Some(ref k) = key {
        voleeo_cookies::crypto::encrypt_values(&mut jar.cookies, k)?;
    }
    cookies_store.save(&jar)?;
    Ok(())
}

impl ApiBackend {
    pub(in crate::api) async fn request_send(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let env_id = args["environmentId"].as_str().map(str::to_string);
        let url_override = args["urlOverride"].as_str().map(str::to_string);

        // Offload blocking file I/O to a dedicated thread.
        let environments = self.environments.clone();
        let requests = self.requests.clone();
        let workspaces = self.workspaces.clone();
        let cookies_store = self.cookies.clone();
        let selections = self.selections.clone();
        let app_data_dir = self.app_data_dir.clone();
        let ws_id2 = ws_id.clone();
        let req_id2 = req_id.clone();
        let env_id2 = env_id.clone();

        let t0 = std::time::Instant::now();
        eprintln!("[mcp] request.send ws={ws_id} req={req_id} env={env_id:?}");

        let prepared = tokio::task::spawn_blocking(move || -> Result<_, String> {
            let mut req = requests
                .get_request(&ws_id2, &req_id2)
                .map_err(|e| e.to_string())?;
            let envs = environments.list(&ws_id2).unwrap_or_default();

            // Require an explicit env when personal ones exist: defaulting to
            // globals would leave their {{ VAR }} tokens unresolved.
            if env_id2.is_none() {
                let personal: Vec<_> = envs
                    .iter()
                    .filter(|e| e.kind == EnvironmentKind::Personal)
                    .collect();
                if !personal.is_empty() {
                    let list = personal
                        .iter()
                        .map(|e| format!("  • {} (id: {})", e.name, e.id))
                        .collect::<Vec<_>>()
                        .join("\n");
                    return Err(format!(
                        "environmentId is required when personal environments exist.\n\
                         Please re-call with one of the following:\n{list}"
                    ));
                }
            }

            // File-only key (the keychain can block 60s headless). Shared by
            // folder-var and cookie decryption below.
            let var_key = voleeo_crypto::load_key_from_file(&ws_id2, &app_data_dir).ok();

            // Folder vars layer over env vars (nearest folder wins) so MCP
            // resolution matches the app's.
            let mut vars =
                resolve::load_env_vars_from(&envs, &ws_id2, env_id2.as_deref(), &app_data_dir);
            let folders = requests.list_folders(&ws_id2).unwrap_or_default();
            resolve::apply_folder_vars(
                &mut vars,
                req.folder_id.as_deref(),
                &folders,
                var_key.as_ref(),
            );
            // Auth secrets are stored as `enc:v1:` ciphertext; the store hands
            // them back raw. Decrypt in place so static schemes inject plaintext
            // and dynamic schemes (SigV4) sign with the real key.
            if let Some(k) = var_key.as_ref() {
                for (secret, encrypted) in req.auth.secret_fields_mut() {
                    if encrypted && voleeo_crypto::is_encrypted(secret) {
                        if let Ok(plain) = voleeo_crypto::decrypt(secret, k) {
                            *secret = plain;
                        }
                    }
                }
            }
            resolve::apply_to_request(&mut req, &vars);

            if let Some(url) = url_override {
                req.url = url;
            }

            // Resolve + decrypt the active jar here (off-runtime). Mirrors the
            // Tauri `load_active_jar_for_send` so MCP uses the same jar as the UI.
            let ws = workspaces.get(&ws_id2).map_err(|e| e.to_string())?;
            // Selection if set, else the first existing jar (mirrors the app's
            // resolve_active_jar), else the auto-created default.
            let jar_id = selections
                .active_jar(&ws_id2)
                .or_else(|| {
                    cookies_store
                        .list(&ws_id2)
                        .ok()
                        .and_then(|jars| jars.into_iter().next().map(|j| j.id))
                })
                .unwrap_or_else(|| voleeo_storage::DEFAULT_JAR_ID.to_string());
            let (mut cookies, jar_id) = match cookies_store.get(&ws_id2, &jar_id) {
                Ok(mut jar) => {
                    if voleeo_cookies::crypto::jar_needs_key(&jar.cookies) {
                        if !ws.encrypted {
                            return Err(
                                "workspace_encryption_required for encrypted cookie values"
                                    .to_string(),
                            );
                        }
                        let key = voleeo_crypto::load_key(&ws_id2, &app_data_dir)
                            .map_err(|e| e.to_string())?;
                        voleeo_cookies::crypto::decrypt_values(&mut jar.cookies, &key)
                            .map_err(|e| e.to_string())?;
                    }
                    (jar.cookies, jar_id)
                }
                Err(e) => {
                    // Soft-fail: send without cookies rather than abort. `get`
                    // auto-creates the default jar, so this is really just I/O
                    // failures we don't want to fatal-error on.
                    eprintln!("[mcp] cookie jar load failed: {e}; sending without cookies");
                    (Vec::new(), jar_id)
                }
            };

            // Resolve `{{ VAR }}`, strip encrypt() chips, decrypt `enc:v1:` in
            // cookie fields — same steps as Tauri `send_request` for one wire form.
            voleeo_cookies::resolve::resolve_cookies(&mut cookies, &vars, var_key.as_ref());

            Ok((req, cookies, jar_id))
        })
        .await;

        let (mut req, attach_cookies, jar_id) = match prepared {
            Ok(Ok(r)) => r,
            Ok(Err(msg)) => return ToolResult::error(msg),
            Err(e) => return ToolResult::error(format!("Internal error: {e}")),
        };

        // OAuth 2.0 resolves to a Bearer from the shared token cache: the
        // non-interactive grants fetch/refresh as needed; authorization_code
        // reuses a token previously acquired via the UI (it can't open a browser
        // here). `apply_to_request` already expanded its `{{ }}` fields. Always
        // `Bearer` — non-Bearer types (MAC/DPoP) need real protocol support, not
        // a scheme swap, so the cached `token_type` is inspector-only.
        if matches!(req.auth, AuthConfig::OAuth2 { .. }) {
            if req.auth.is_active() {
                if let Some(config) = voleeo_oauth::OAuth2Config::from_auth(&req.auth) {
                    let encrypted = self
                        .workspaces
                        .get(&ws_id)
                        .map(|w| w.encrypted)
                        .unwrap_or(false);
                    match voleeo_oauth::ensure_token(&self.app_data_dir, &ws_id, encrypted, &config)
                        .await
                    {
                        Ok(token) => req.headers.push(resolve::auth_header(
                            "Authorization",
                            format!("Bearer {token}"),
                        )),
                        Err(e) => return ToolResult::error(format!("OAuth 2.0: {e}")),
                    }
                }
            }
            req.auth = AuthConfig::None;
        }

        eprintln!(
            "[mcp] prepared in {:.0}ms — sending {} {} (jar={jar_id}, {} cookie(s))",
            t0.elapsed().as_secs_f64() * 1000.0,
            req.method,
            redact::redact_url(&req.url),
            attach_cookies.len(),
        );

        // 30s timeout so the MCP client never hangs indefinitely.
        let dns_overrides = self
            .workspaces
            .get(&ws_id)
            .map(|w| w.dns_overrides)
            .unwrap_or_default();
        // `send_guarded`: the AI picks the destination, so refuse link-local /
        // cloud-metadata targets (re-checked on each redirect hop).
        let send_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.executor
                .send_guarded(&req, attach_cookies, dns_overrides),
        )
        .await;

        match send_result {
            Err(_) => {
                eprintln!(
                    "[mcp] timed out after {:.0}ms: {} {}",
                    t0.elapsed().as_secs_f64() * 1000.0,
                    req.method,
                    redact::redact_url(&req.url)
                );
                ToolResult::error(
                    "Request timed out after 30 seconds. \
                     Check the URL and that the server is reachable.",
                )
            }
            Ok(Err(VoleeoError::Cancelled)) => ToolResult::error("Request cancelled"),
            Ok(Err(e)) => {
                let msg = redact::redact_error(&e.to_string());
                eprintln!(
                    "[mcp] failed after {:.0}ms: {msg}",
                    t0.elapsed().as_secs_f64() * 1000.0
                );
                ToolResult::error(msg)
            }
            Ok(Ok(resp)) => {
                eprintln!(
                    "[mcp] response {} in {:.0}ms (total wall {:.0}ms)",
                    resp.status,
                    resp.timing.total_ms,
                    t0.elapsed().as_secs_f64() * 1000.0
                );

                // Ingest captured cookies into the active jar. We block on it:
                // a follow-up tool call inspecting the jar must see them (e.g. an
                // auth flow that logs in, then hits a protected endpoint).
                if !resp.captured_cookies.is_empty() {
                    let captured = resp.captured_cookies.clone();
                    let workspaces = self.workspaces.clone();
                    let cookies_store = self.cookies.clone();
                    let app_data_dir = self.app_data_dir.clone();
                    let ws_for_ingest = ws_id.clone();
                    let jar_for_ingest = jar_id.clone();
                    let ingest = tokio::task::spawn_blocking(move || {
                        ingest_captured_blocking(
                            &workspaces,
                            &cookies_store,
                            &app_data_dir,
                            &ws_for_ingest,
                            &jar_for_ingest,
                            &captured,
                        )
                    })
                    .await;
                    match ingest {
                        Ok(Ok(())) => self.notify_cookies(&ws_id),
                        Ok(Err(e)) => {
                            eprintln!("[mcp] failed to ingest captured cookies: {e}")
                        }
                        Err(e) => eprintln!("[mcp] cookie ingest task panicked: {e}"),
                    }
                }

                let limit = 20_usize;
                let responses = self.responses.clone();
                let resp_clone = resp.clone();
                let notify = self.notify.clone();
                tokio::task::spawn_blocking(move || {
                    match responses.append(&ws_id, &req_id, resp_clone, limit) {
                        Ok(_) => notify(
                            "mcp:response:stored",
                            serde_json::json!({ "workspaceId": ws_id, "requestId": req_id }),
                        ),
                        Err(e) => eprintln!("[mcp] failed to store response history: {e}"),
                    }
                });
                ToolResult::json(&resp)
            }
        }
    }
}
