//! MCP tool handlers for the per-workspace cookie jar. Mirrors the in-app
//! Cookies modal: list jars, inspect cookies in a jar, switch the active jar,
//! upsert a cookie, and clear a jar wholesale.
//!
//! Encryption parity with the Tauri command layer is enforced via the free
//! `decrypt_jar` / `encrypt_jar` helpers — both sides traverse the same
//! `voleeo_cookies::crypto` loop. They're free fns (not `&self` methods) so the
//! mutating handlers can call them inside `spawn_blocking` (`'static` captures).

use super::{redact, ApiBackend};
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::{SameSite, StoredCookie, VoleeoError};

impl ApiBackend {
    pub(super) async fn cookie_list_jars(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let reveal = redact::reveal(args);
        let cookies = self.cookies.clone();
        let workspaces = self.workspaces.clone();
        let app_data_dir = self.app_data_dir.clone();
        super::run_blocking(move || {
            let mut jars = match cookies.list(&ws_id) {
                Ok(j) => j,
                Err(e) => return ToolResult::error(e.to_string()),
            };
            // Default: mask values (and skip decryption, so no keychain touch).
            // With reveal=true, decrypt so the AI sees the same plaintext the UI
            // does; if the keychain is unavailable, show ciphertext rather than
            // failing the whole list call.
            for jar in jars.iter_mut() {
                if reveal {
                    if let Err(e) = decrypt_jar(&workspaces, &app_data_dir, jar) {
                        eprintln!("[mcp] cookie.list_jars decrypt failed for {}: {e}", jar.id);
                    }
                } else {
                    redact::mask_cookies(jar);
                }
            }
            ToolResult::json(&jars)
        })
        .await
    }

    pub(super) async fn cookie_get_jar(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let jar_id = require!(args, "jarId");
        let reveal = redact::reveal(args);
        let cookies = self.cookies.clone();
        let workspaces = self.workspaces.clone();
        let app_data_dir = self.app_data_dir.clone();
        super::run_blocking(move || {
            let mut jar = match cookies.get(&ws_id, &jar_id) {
                Ok(j) => j,
                Err(e) => return ToolResult::error(e.to_string()),
            };
            if reveal {
                if let Err(e) = decrypt_jar(&workspaces, &app_data_dir, &mut jar) {
                    return ToolResult::error(e.to_string());
                }
            } else {
                redact::mask_cookies(&mut jar);
            }
            ToolResult::json(&jar)
        })
        .await
    }

    pub(super) async fn cookie_set_active_jar(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        // `jarId` is required for this tool (unlike the Tauri equivalent which
        // accepts None to unset) — clearing the active jar isn't a useful AI
        // operation: there's always a default jar to fall back to.
        let jar_id = require!(args, "jarId");

        let cookies = self.cookies.clone();
        let selections = self.selections.clone();
        let ws = ws_id.clone();
        let jar = jar_id.clone();
        let result = super::blocking(move || -> Result<(), VoleeoError> {
            // Validate the jar exists before assigning. Machine-local selection
            // (shared with the app, not synced via git), so the agent and UI
            // agree on which jar is active.
            cookies.get(&ws, &jar)?;
            selections.set_active_jar(&ws, Some(&jar))?;
            Ok(())
        })
        .await;
        match result {
            Ok(()) => {
                // Notify so the TopBar chip + Cookies modal refresh.
                self.notify_cookies(&ws_id);
                ToolResult::json(&serde_json::json!({
                    "workspaceId": ws_id,
                    "activeJarId": jar_id,
                }))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn cookie_set_cookie(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let jar_id = require!(args, "jarId");
        let domain = require!(args, "domain");
        let name = require!(args, "name");
        let value = require!(args, "value");

        // Refuse the read-mask placeholder so a masked cookie read echoed back
        // here can't overwrite a real cookie value with the marker.
        if redact::is_mask(&value) {
            return ToolResult::error(
                "value is the masked placeholder; pass the real cookie value \
                 (read the jar with reveal=true to see it)",
            );
        }

        let path = args["path"].as_str().unwrap_or("/").to_string();
        let host_only = args["hostOnly"].as_bool().unwrap_or(true);
        let secure = args["secure"].as_bool().unwrap_or(false);
        let http_only = args["httpOnly"].as_bool().unwrap_or(false);
        let same_site = args["sameSite"]
            .as_str()
            .and_then(parse_same_site)
            // Surface a clear error rather than silently dropping the field.
            .or_else(|| args["sameSite"].as_str().map(|_| SameSite::Lax));
        if let Some(s) = args["sameSite"].as_str() {
            if parse_same_site(s).is_none() {
                return ToolResult::error(format!(
                    "invalid sameSite \"{s}\" — expected Strict, Lax, or None"
                ));
            }
        }
        let expires = args["expires"].as_str().map(str::to_string);

        let cookies = self.cookies.clone();
        let workspaces = self.workspaces.clone();
        let app_data_dir = self.app_data_dir.clone();
        let ws = ws_id.clone();
        let result = super::blocking(move || -> Result<StoredCookie, VoleeoError> {
            // The workspace's encryption flag decides whether the value lands as
            // ciphertext on disk.
            let ws_meta = workspaces.get(&ws)?;
            let now = chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.6f")
                .to_string();

            let mut jar = cookies.get(&ws, &jar_id)?;
            decrypt_jar(&workspaces, &app_data_dir, &mut jar)?;

            // Upsert by RFC 6265 identity (domain, path, name).
            let pos = jar
                .cookies
                .iter()
                .position(|c| voleeo_cookies::matching::matches_identity(c, &domain, &path, &name));

            let saved: StoredCookie = if let Some(idx) = pos {
                let existing = &mut jar.cookies[idx];
                existing.value = value;
                existing.host_only = host_only;
                existing.secure = secure;
                existing.http_only = http_only;
                existing.same_site = same_site;
                existing.expires = expires;
                existing.value_encrypted = ws_meta.encrypted;
                existing.updated_at = now.clone();
                existing.clone()
            } else {
                let cookie = StoredCookie {
                    id: format!("ck_{}", voleeo_core::new_id()),
                    domain,
                    host_only,
                    path,
                    name,
                    value,
                    value_encrypted: ws_meta.encrypted,
                    secure,
                    http_only,
                    same_site,
                    expires,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                jar.cookies.push(cookie.clone());
                cookie
            };

            jar.updated_at = now;
            encrypt_jar(&workspaces, &app_data_dir, &mut jar)?;
            cookies.save(&jar)?;
            Ok(saved)
        })
        .await;
        match result {
            Ok(saved) => {
                self.notify_cookies(&ws_id);
                ToolResult::json(&saved)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn cookie_clear_jar(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let jar_id = require!(args, "jarId");
        let cookies = self.cookies.clone();
        let ws = ws_id.clone();
        match super::blocking(move || clear_jar_impl(&cookies, &ws, &jar_id)).await {
            Ok(jar) => {
                self.notify_cookies(&ws_id);
                ToolResult::json(&jar)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

/// Off-`self` mirror of `ApiBackend::decrypt_cookies` for use inside
/// `spawn_blocking` (which needs `'static` captures, so it can't borrow `self`).
fn decrypt_jar(
    workspaces: &voleeo_storage::WorkspaceStore,
    app_data_dir: &std::path::Path,
    jar: &mut voleeo_core::CookieJar,
) -> Result<(), VoleeoError> {
    if !voleeo_cookies::crypto::jar_needs_key(&jar.cookies) {
        return Ok(());
    }
    let ws = workspaces.get(&jar.workspace_id)?;
    if !ws.encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = voleeo_crypto::load_key(&jar.workspace_id, app_data_dir)?;
    voleeo_cookies::crypto::decrypt_values(&mut jar.cookies, &key)
}

/// Encrypt jar values in place when it carries `value_encrypted: true` cookies.
/// Free-fn counterpart to `decrypt_jar`, usable inside `spawn_blocking`.
fn encrypt_jar(
    workspaces: &voleeo_storage::WorkspaceStore,
    app_data_dir: &std::path::Path,
    jar: &mut voleeo_core::CookieJar,
) -> Result<(), VoleeoError> {
    if !voleeo_cookies::crypto::jar_needs_key(&jar.cookies) {
        return Ok(());
    }
    let ws = workspaces.get(&jar.workspace_id)?;
    if !ws.encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = voleeo_crypto::load_key(&jar.workspace_id, app_data_dir)?;
    voleeo_cookies::crypto::encrypt_values(&mut jar.cookies, &key)
}

fn parse_same_site(s: &str) -> Option<SameSite> {
    match s.to_ascii_lowercase().as_str() {
        "strict" => Some(SameSite::Strict),
        "lax" => Some(SameSite::Lax),
        "none" => Some(SameSite::None),
        _ => None,
    }
}

fn clear_jar_impl(
    cookies: &voleeo_storage::CookieJarStore,
    workspace_id: &str,
    jar_id: &str,
) -> Result<voleeo_core::CookieJar, VoleeoError> {
    let mut jar = cookies.get(workspace_id, jar_id)?;
    jar.cookies.clear();
    jar.updated_at = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string();
    cookies.save(&jar)?;
    Ok(jar)
}
