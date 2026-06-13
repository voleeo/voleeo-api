use super::ApiBackend;
use crate::{protocol::ToolResult, resolve};
use serde_json::Value;
use std::path::Path;
use voleeo_core::{EnvironmentKind, StoredCookie, VoleeoError};
use voleeo_storage::{CookieJarStore, WorkspaceStore};

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
    pub(super) async fn request_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let requests = self.requests.clone();
        super::run_blocking(move || {
            let reqs = requests.list_requests(&ws_id);
            let folders = requests.list_folders(&ws_id);
            match (reqs, folders) {
                (Ok(reqs), Ok(folders)) => {
                    ToolResult::json(&serde_json::json!({ "requests": reqs, "folders": folders }))
                }
                (Err(e), _) | (_, Err(e)) => ToolResult::error(e.to_string()),
            }
        })
        .await
    }

    pub(super) async fn request_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let requests = self.requests.clone();
        super::run_blocking(move || match requests.get_request(&ws_id, &req_id) {
            Ok(req) => ToolResult::json(&req),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) fn request_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let method = require!(args, "method");
        let url = require!(args, "url");
        let folder_id = args["folderId"].as_str().map(str::to_string);
        match self
            .requests
            .create_request(ws_id.clone(), folder_id, name, method, url)
        {
            Ok(req) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) fn request_update(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let mut req = match self.requests.get_request(&ws_id, &req_id) {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        // Rename is separate: the filename stays `req_{id}.yaml`.
        if let Some(n) = args["name"].as_str() {
            if let Err(e) = self.requests.rename_request(&ws_id, &req_id, n.to_string()) {
                return ToolResult::error(e.to_string());
            }
            req.name = n.to_string();
        }
        if let Some(m) = args["method"].as_str() {
            req.method = m.to_string();
        }
        if let Some(u) = args["url"].as_str() {
            req.url = u.to_string();
        }
        if let Some(q) = args["graphqlQuery"].as_str() {
            let variables = args["graphqlVariables"].as_str().map(str::to_string);
            req.body = Some(voleeo_core::RequestBody {
                kind: voleeo_core::BodyKind::Graphql,
                text: q.to_string(),
                graphql_variables: variables,
                ..Default::default()
            });
            if req.method.eq_ignore_ascii_case("GET") {
                req.method = "POST".to_string();
            }
        } else if let (Some(v), Some(body)) = (args["graphqlVariables"].as_str(), req.body.as_mut())
        {
            if matches!(body.kind, voleeo_core::BodyKind::Graphql) {
                body.graphql_variables = Some(v.to_string());
            }
        }
        match self.requests.update_request(
            &ws_id,
            &req_id,
            req.method.clone(),
            req.url.clone(),
            req.parameters.clone(),
            req.headers.clone(),
            req.body.clone(),
            req.auth.clone(),
        ) {
            Ok(()) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) fn request_duplicate(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        match self.requests.duplicate_request(&ws_id, &req_id) {
            Ok(req) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn request_send(&self, args: &Value) -> ToolResult {
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

        let (req, attach_cookies, jar_id) = match prepared {
            Ok(Ok(r)) => r,
            Ok(Err(msg)) => return ToolResult::error(msg),
            Err(e) => return ToolResult::error(format!("Internal error: {e}")),
        };

        eprintln!(
            "[mcp] prepared in {:.0}ms — sending {} {} (jar={jar_id}, {} cookie(s))",
            t0.elapsed().as_secs_f64() * 1000.0,
            req.method,
            req.url,
            attach_cookies.len(),
        );

        // 30s timeout so the MCP client never hangs indefinitely.
        let dns_overrides = self
            .workspaces
            .get(&ws_id)
            .map(|w| w.dns_overrides)
            .unwrap_or_default();
        let send_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.executor.send(&req, attach_cookies, dns_overrides),
        )
        .await;

        match send_result {
            Err(_) => {
                eprintln!(
                    "[mcp] timed out after {:.0}ms: {} {}",
                    t0.elapsed().as_secs_f64() * 1000.0,
                    req.method,
                    req.url
                );
                ToolResult::error(
                    "Request timed out after 30 seconds. \
                     Check the URL and that the server is reachable.",
                )
            }
            Ok(Err(VoleeoError::Cancelled)) => ToolResult::error("Request cancelled"),
            Ok(Err(e)) => {
                eprintln!(
                    "[mcp] failed after {:.0}ms: {e}",
                    t0.elapsed().as_secs_f64() * 1000.0
                );
                ToolResult::error(e.to_string())
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
