use std::path::PathBuf;
use tauri::State;
use voleeo_cookies::crypto as cookie_crypto;
use voleeo_core::{CookieJar, StoredCookie, VoleeoError};
use voleeo_storage::{CookieJarStore, SelectionStore, WorkspaceStore, DEFAULT_JAR_ID};

use crate::commands::request::run_blocking;
use crate::state::AppState;

/// Direction of the cookie-value transform — mirrors `transform_auth_secrets`
/// for request auth secrets: plaintext over IPC, ciphertext on disk when the
/// workspace is encrypted.
enum Direction {
    Decrypt,
    Encrypt,
}

/// Cloneable bundle of every store + path the cookie commands touch. Lets each
/// command extract once at the boundary then move the bundle into a single
/// `spawn_blocking` so the YAML + crypto round-trip never stalls the runtime.
#[derive(Clone)]
struct Stores {
    cookies: CookieJarStore,
    workspaces: WorkspaceStore,
    selections: SelectionStore,
    app_data_dir: PathBuf,
}

impl Stores {
    fn from(state: &AppState) -> Self {
        Self {
            cookies: state.cookies.clone(),
            workspaces: state.workspaces.clone(),
            selections: state.selections.clone(),
            app_data_dir: state.app_data_dir.clone(),
        }
    }
}

fn transform_cookie_values(
    jar: &mut CookieJar,
    stores: &Stores,
    direction: Direction,
) -> Result<(), VoleeoError> {
    if !cookie_crypto::jar_needs_key(&jar.cookies) {
        return Ok(());
    }
    let ws = stores.workspaces.get(&jar.workspace_id)?;
    if !ws.encrypted {
        return Err(VoleeoError::InvalidConfig(
            "workspace_encryption_required".to_string(),
        ));
    }
    let key = voleeo_crypto::load_key(&jar.workspace_id, &stores.app_data_dir)?;
    match direction {
        Direction::Decrypt => cookie_crypto::decrypt_values(&mut jar.cookies, &key),
        Direction::Encrypt => cookie_crypto::encrypt_values(&mut jar.cookies, &key),
    }
}

/// Microsecond-precision ISO-8601 timestamp. The single home for the format
/// string used by every `updated_at` write in this module — keeps the on-disk
/// timestamps uniform and avoids drift if the precision ever changes.
fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string()
}

fn touch_jar(jar: &mut CookieJar) {
    jar.updated_at = now_iso();
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_list_jars(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<CookieJar>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        // Soft-expire: keep expired cookies on disk so the UI can surface them
        // (greyed out, with an "expired" chip + Clear-expired action). The
        // send path still filters them via `matching::matching`, so they
        // never go out on the wire even though they remain visible.
        let mut jars = stores.cookies.list(&workspace_id)?;
        for jar in jars.iter_mut() {
            transform_cookie_values(jar, &stores, Direction::Decrypt)?;
        }
        Ok(jars)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_create_jar(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<CookieJar, VoleeoError> {
    let cookies = state.cookies.clone();
    run_blocking(move || cookies.create(workspace_id, name)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_rename_jar(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
    name: String,
) -> Result<CookieJar, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut jar = stores.cookies.get(&workspace_id, &jar_id)?;
        jar.name = name;
        touch_jar(&mut jar);
        // Encrypt before save (values may already be ciphertext on disk; this
        // is a no-op for cookies whose value_encrypted=false).
        let mut to_save = jar.clone();
        transform_cookie_values(&mut to_save, &stores, Direction::Encrypt)?;
        stores.cookies.save(&to_save)?;
        transform_cookie_values(&mut jar, &stores, Direction::Decrypt)?;
        Ok(jar)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_delete_jar(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
) -> Result<Option<String>, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        stores.cookies.delete(&workspace_id, &jar_id)?;
        // If the deleted jar was active, fall back to the first remaining jar.
        if stores.selections.active_jar(&workspace_id).as_deref() == Some(jar_id.as_str()) {
            let remaining = stores.cookies.list(&workspace_id)?;
            let next = remaining.first().map(|j| j.id.clone());
            stores
                .selections
                .set_active_jar(&workspace_id, next.as_deref())?;
        }
        // The active jar to show now (selection, or first-jar/default fallback).
        Ok(Some(resolve_active_jar(&stores, &workspace_id)))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_set_active_jar(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: Option<String>,
) -> Result<(), VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        if let Some(ref id) = jar_id {
            // Validate the jar exists.
            let _ = stores.cookies.get(&workspace_id, id)?;
        }

        stores
            .selections
            .set_active_jar(&workspace_id, jar_id.as_deref())
    })
    .await
}

/// The active cookie jar id for a workspace, falling back to the default jar.
/// Lets the frontend hydrate its selection on load without a synced field.
#[tauri::command]
#[specta::specta]
pub async fn cookies_get_active_jar(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || Ok(resolve_active_jar(&stores, &workspace_id))).await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_save_cookie(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
    cookie: StoredCookie,
) -> Result<StoredCookie, VoleeoError> {
    let stores = Stores::from(&state);
    run_blocking(move || {
        let mut jar = stores.cookies.get(&workspace_id, &jar_id)?;
        // Decrypt existing values so we operate on plaintext, then re-encrypt
        // on save.
        transform_cookie_values(&mut jar, &stores, Direction::Decrypt)?;

        let now = now_iso();
        // Upsert by id when provided, otherwise by the shared RFC 6265 key
        // (domain, path, name).
        let pos = if !cookie.id.is_empty() {
            jar.cookies.iter().position(|c| c.id == cookie.id)
        } else {
            jar.cookies
                .iter()
                .position(|c| voleeo_cookies::matching::same_identity(c, &cookie))
        };

        let saved = if let Some(idx) = pos {
            let existing = &mut jar.cookies[idx];
            let id = existing.id.clone();
            let created_at = existing.created_at.clone();
            *existing = StoredCookie {
                id,
                created_at,
                updated_at: now.clone(),
                ..cookie
            };
            existing.clone()
        } else {
            let mut new = cookie;
            if new.id.is_empty() {
                new.id = format!("ck_{}", voleeo_core::new_id());
            }
            new.created_at = now.clone();
            new.updated_at = now;
            jar.cookies.push(new.clone());
            new
        };

        touch_jar(&mut jar);
        transform_cookie_values(&mut jar, &stores, Direction::Encrypt)?;
        stores.cookies.save(&jar)?;
        Ok(saved)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_delete_cookie(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
    cookie_id: String,
) -> Result<(), VoleeoError> {
    let cookies = state.cookies.clone();
    run_blocking(move || {
        let mut jar = cookies.get(&workspace_id, &jar_id)?;
        jar.cookies.retain(|c| c.id != cookie_id);
        touch_jar(&mut jar);
        cookies.save(&jar)?;
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_clear_jar(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
) -> Result<(), VoleeoError> {
    let cookies = state.cookies.clone();
    run_blocking(move || {
        let mut jar = cookies.get(&workspace_id, &jar_id)?;
        jar.cookies.clear();
        touch_jar(&mut jar);
        cookies.save(&jar)?;
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cookies_clear_expired(
    state: State<'_, AppState>,
    workspace_id: String,
    jar_id: String,
) -> Result<u32, VoleeoError> {
    let cookies = state.cookies.clone();
    run_blocking(move || {
        let mut jar = cookies.get(&workspace_id, &jar_id)?;
        let pruned = voleeo_cookies::matching::prune_expired(&mut jar.cookies, chrono::Utc::now());
        if pruned > 0 {
            touch_jar(&mut jar);
            cookies.save(&jar)?;
        }
        Ok(pruned as u32)
    })
    .await
}

/// Resolve the active jar id for a workspace: the machine-local selection if
/// set, else the first existing jar (the Default jar for normal workspaces),
/// else `DEFAULT_JAR_ID` (which `get` auto-creates). The first-jar fallback
/// mirrors the frontend's `resolveActive`, so a freshly-loaded workspace with
/// no stored selection still sends with the user's jar instead of a blank one.
fn resolve_active_jar(stores: &Stores, workspace_id: &str) -> String {
    if let Some(id) = stores.selections.active_jar(workspace_id) {
        return id;
    }
    stores
        .cookies
        .list(workspace_id)
        .ok()
        .and_then(|jars| jars.first().map(|j| j.id.clone()))
        .unwrap_or_else(|| DEFAULT_JAR_ID.to_string())
}

/// Resolve the active jar id for a workspace without loading the jar's
/// contents. Used by `send_request` when the frontend has already supplied
/// pre-resolved cookies — we still need the jar id to ingest any cookies
/// captured during the response.
pub(crate) async fn active_jar_id_for_workspace(
    state: &AppState,
    workspace_id: &str,
) -> Result<String, VoleeoError> {
    let stores = Stores::from(state);
    let workspace_id = workspace_id.to_string();
    run_blocking(move || Ok(resolve_active_jar(&stores, &workspace_id))).await
}

/// Load the active jar's cookies with values decrypted, ready to attach to
/// outgoing HTTP requests. Called from `send_request`, which itself runs on
/// the tokio runtime — the sync I/O is bridged via `spawn_blocking`.
pub(crate) async fn load_active_jar_for_send(
    state: &AppState,
    workspace_id: &str,
) -> Result<(String, Vec<StoredCookie>), VoleeoError> {
    let stores = Stores::from(state);
    let workspace_id = workspace_id.to_string();
    run_blocking(move || {
        let jar_id = resolve_active_jar(&stores, &workspace_id);
        let mut jar = stores.cookies.get(&workspace_id, &jar_id)?;
        transform_cookie_values(&mut jar, &stores, Direction::Decrypt)?;
        // No explicit prune here — `matching::matching` filters expired
        // entries when it builds the Cookie header, so they're already
        // excluded from the wire even though they stay on disk for the UI
        // to surface.
        Ok((jar_id, jar.cookies))
    })
    .await
}

/// Persist freshly captured cookies into the active jar. Encrypts values when
/// the workspace is encrypted (auto-captured cookies inherit the workspace's
/// encryption posture: encrypted ⇒ `value_encrypted = true`).
pub(crate) async fn ingest_captured_cookies(
    state: &AppState,
    workspace_id: &str,
    jar_id: &str,
    captured: &[StoredCookie],
) -> Result<(), VoleeoError> {
    if captured.is_empty() {
        return Ok(());
    }
    let stores = Stores::from(state);
    let workspace_id = workspace_id.to_string();
    let jar_id = jar_id.to_string();
    let captured = captured.to_vec();
    run_blocking(move || {
        let ws = stores.workspaces.get(&workspace_id)?;
        let mut jar = stores.cookies.get(&workspace_id, &jar_id)?;
        transform_cookie_values(&mut jar, &stores, Direction::Decrypt)?;
        for fresh in &captured {
            // Upsert by the shared RFC 6265 key.
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
        touch_jar(&mut jar);
        transform_cookie_values(&mut jar, &stores, Direction::Encrypt)?;
        stores.cookies.save(&jar)?;
        Ok(())
    })
    .await
}
