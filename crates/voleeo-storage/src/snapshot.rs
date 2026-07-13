//! `snapshot_*.yaml` — immutable, git-synced request/response snapshots.
//!
//! Unlike `response.rs` (a machine-local rolling ring buffer), each snapshot is
//! its own file inside `workspaces/{id}/`, written once and never edited
//! except for `rename`. There is deliberately no `update`.

use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, AuthConfig, HttpRequest, HttpResponse, Snapshot, VoleeoError};

use crate::snapshot_redact::{
    decrypt_url_ciphertext, has_redacted_secrets, treat_static_auth_injection,
};
use crate::workspace::WorkspaceStore;

/// A saved snapshot is one immutable file — never windowed or side-filed like
/// response history — so an oversized body is refused up front rather than
/// truncated.
pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

/// Sentinel written over a secret value in an unencrypted workspace's snapshot.
/// Exported so callers (replay) can detect a snapshot that can't be replayed with
/// real auth — the value was structurally discarded, not just hidden.
pub const REDACTED: &str = "‹redacted›";

#[derive(Clone)]
pub struct SnapshotStore {
    /// `{app_data_dir}/workspaces/`
    workspaces_dir: PathBuf,
    app_data_dir: PathBuf,
    workspaces: WorkspaceStore,
}

impl SnapshotStore {
    pub fn new(
        app_data_dir: impl AsRef<Path>,
        workspaces: WorkspaceStore,
    ) -> Result<Self, VoleeoError> {
        let app_data_dir = app_data_dir.as_ref().to_path_buf();
        let workspaces_dir = app_data_dir.join("workspaces");
        std::fs::create_dir_all(&workspaces_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            workspaces_dir,
            app_data_dir,
            workspaces,
        })
    }

    fn snapshot_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("snapshot_{id}.yaml")))
    }

    pub fn get(&self, workspace_id: &str, id: &str) -> Result<Snapshot, VoleeoError> {
        let path = self.snapshot_path(workspace_id, id)?;
        if !path.exists() {
            return Err(VoleeoError::NotFound(format!("snapshot {id}")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    /// Every snapshot in the workspace (all requests). Optionally filtered below.
    fn read_all(&self, workspace_id: &str) -> Result<Vec<Snapshot>, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.workspaces_dir.join(workspace_id);
        let mut items = Vec::new();
        if !dir.exists() {
            return Ok(items);
        }
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("snapshot_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let Ok(snapshot) = serde_yaml::from_str::<Snapshot>(&content) else {
                continue;
            };
            items.push(snapshot);
        }
        // Pinned first, then oldest→newest within each group.
        items.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    pub fn list(&self, workspace_id: &str, request_id: &str) -> Result<Vec<Snapshot>, VoleeoError> {
        let mut items = self.read_all(workspace_id)?;
        items.retain(|p| p.request_id == request_id);
        Ok(items)
    }

    /// Lightweight listing across the whole workspace — one call feeds the
    /// sidebar tree without shipping any bodies over IPC.
    pub fn list_summaries(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<voleeo_core::SnapshotSummary>, VoleeoError> {
        Ok(self
            .read_all(workspace_id)?
            .iter()
            .map(|p| voleeo_core::SnapshotSummary {
                id: p.id.clone(),
                request_id: p.request_id.clone(),
                name: p.name.clone(),
                created_at: p.created_at.clone(),
                encrypted: p.encrypted,
                pinned: p.pinned,
                method: p.request.method.clone(),
                status: p.response.status,
            })
            .collect())
    }

    pub fn rename(
        &self,
        workspace_id: &str,
        id: &str,
        name: String,
    ) -> Result<Snapshot, VoleeoError> {
        let mut snapshot = self.get(workspace_id, id)?;
        snapshot.name = name;
        let content =
            serde_yaml::to_string(&snapshot).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(self.snapshot_path(workspace_id, id)?, content)?;
        Ok(snapshot)
    }

    pub fn set_pinned(
        &self,
        workspace_id: &str,
        id: &str,
        pinned: bool,
    ) -> Result<Snapshot, VoleeoError> {
        let mut snapshot = self.get(workspace_id, id)?;
        snapshot.pinned = pinned;
        let content =
            serde_yaml::to_string(&snapshot).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(self.snapshot_path(workspace_id, id)?, content)?;
        Ok(snapshot)
    }

    pub fn delete(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let path = self.snapshot_path(workspace_id, id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    /// Delete every snapshot belonging to `request_id` (parent-request cascade
    /// delete). Returns the count removed, for the caller's confirm dialog.
    pub fn delete_by_request(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<usize, VoleeoError> {
        let snapshots = self.list(workspace_id, request_id)?;
        for p in &snapshots {
            self.delete(workspace_id, &p.id)?;
        }
        Ok(snapshots.len())
    }

    /// Build a ready-to-send `HttpRequest` + the cookies to attach for
    /// replaying `snapshot` — the symmetric inverse of `save`'s encrypt step.
    /// Static parts (URL/headers/body) come back verbatim; secret values
    /// ciphertext-encrypted at save time are decrypted in place. Dynamic auth
    /// (SigV4/OAuth1/Digest/NTLM) comes back with its saved, now-plaintext
    /// config — the caller's HTTP executor signs it fresh at send time.
    ///
    /// Replay is hermetic: the returned cookies are the snapshot's saved
    /// `attached_cookies` (what was actually sent), never the current jar.
    ///
    /// Errors if the snapshot's secrets were redacted rather than encrypted
    /// (`has_redacted_secrets`) — there is nothing to recover, by design.
    pub fn prepare_for_replay(
        &self,
        workspace_id: &str,
        snapshot: &Snapshot,
    ) -> Result<(HttpRequest, Vec<voleeo_core::StoredCookie>), VoleeoError> {
        if has_redacted_secrets(snapshot) {
            return Err(VoleeoError::InvalidConfig(
                "this snapshot's auth was redacted at save time (unencrypted workspace) — \
                 enable workspace encryption to make snapshots replayable with real auth"
                    .to_string(),
            ));
        }
        let mut request = snapshot.request.clone();
        let mut cookies = snapshot.response.attached_cookies.clone();
        if snapshot.encrypted {
            let key = voleeo_crypto::load_key_from_file(workspace_id, &self.app_data_dir)?;
            for (secret, _) in request.auth.secret_fields_mut() {
                if voleeo_crypto::is_encrypted(secret) {
                    *secret = voleeo_crypto::decrypt(secret, &key)?;
                }
            }
            for h in &mut request.headers {
                if voleeo_crypto::is_encrypted(&h.value) {
                    h.value = voleeo_crypto::decrypt(&h.value, &key)?;
                }
            }
            decrypt_url_ciphertext(&mut request.url, &key)?;
            for c in &mut cookies {
                if voleeo_crypto::is_encrypted(&c.value) {
                    c.value = voleeo_crypto::decrypt(&c.value, &key)?;
                    c.value_encrypted = false;
                }
            }
        }
        Ok((request, cookies))
    }

    /// A copy of `snapshot` with everything a human/agent reads decrypted:
    /// response body/headers/cookies, the request's auth-injected header/URL
    /// values, and the auth *config* secret fields (so the read-only AUTH tab can
    /// reveal the same value the folded header already exposes). Falls back to the
    /// stored (ciphertext) snapshot when the workspace key isn't on this machine.
    pub fn decrypt_for_display(&self, workspace_id: &str, snapshot: Snapshot) -> Snapshot {
        if !snapshot.encrypted {
            return snapshot;
        }
        let Ok(key) = voleeo_crypto::load_key_from_file(workspace_id, &self.app_data_dir) else {
            return snapshot;
        };
        let mut snapshot = snapshot;
        let dec = |v: &mut String| {
            if voleeo_crypto::is_encrypted(v) {
                if let Ok(plain) = voleeo_crypto::decrypt(v, &key) {
                    *v = plain;
                }
            }
        };
        dec(&mut snapshot.response.body);
        for h in &mut snapshot.response.headers {
            dec(&mut h.value);
        }
        for c in snapshot
            .response
            .captured_cookies
            .iter_mut()
            .chain(snapshot.response.attached_cookies.iter_mut())
        {
            dec(&mut c.value);
        }
        for h in &mut snapshot.request.headers {
            dec(&mut h.value);
        }
        for (secret, _) in snapshot.request.auth.secret_fields_mut() {
            dec(secret);
        }
        let _ = decrypt_url_ciphertext(&mut snapshot.request.url, &key);
        snapshot
    }

    /// One-call promotion used by both the Tauri command and the MCP tool:
    /// look up the stored response, take its send-time `resolved_request`,
    /// inflate a windowed body from its side file, and `save` the snapshot.
    /// The default name strips the URL query — a query-located API key must
    /// not leak into the (never-encrypted) name field.
    pub fn promote(
        &self,
        responses: &crate::ResponseStore,
        requests: &crate::RequestStore,
        workspace_id: &str,
        request_id: &str,
        response_id: &str,
        name: Option<String>,
    ) -> Result<Snapshot, VoleeoError> {
        let stored = responses
            .get(workspace_id, request_id, response_id)?
            .ok_or_else(|| VoleeoError::NotFound(format!("response {response_id}")))?;
        let resolved_request = stored.resolved_request.clone().ok_or_else(|| {
            VoleeoError::InvalidConfig(
                "this response predates saved snapshots and has no captured request".into(),
            )
        })?;
        let mut response = stored.response.clone();
        response.body = responses.read_full_body(workspace_id, &stored)?;
        response.body_windowed = false;

        // Redact the folded auth header against the auth AS IT WAS AT SEND TIME
        // (captured on `resolved_request.auth`), so a key rename/scheme switch
        // between send and save can't leave the secret un-redacted. Fall back to
        // the request's current auth only for responses captured before send-time
        // auth was preserved (transient ring-buffer entries).
        let original_auth = if resolved_request.auth.is_active() {
            resolved_request.auth.clone()
        } else {
            requests.get_request(workspace_id, request_id)?.auth
        };
        let name = name.unwrap_or_else(|| {
            // Path only — drop the query, then the scheme + host, so the default
            // reads e.g. `200 /api/v1/pokemon/random`.
            let bare = resolved_request.url.split('?').next().unwrap_or_default();
            let after_scheme = bare.split("://").nth(1).unwrap_or(bare);
            let path = after_scheme.find('/').map_or("/", |i| &after_scheme[i..]);
            format!("{} {path}", response.status)
        });
        self.save(
            workspace_id,
            request_id,
            name,
            response,
            resolved_request,
            &original_auth,
        )
    }

    /// Promote an already-captured response + its resolved request (see
    /// `StoredHttpResponse::resolved_request`) into an immutable snapshot.
    /// Never re-resolves — the caller supplies exactly what was sent.
    ///
    /// `original_auth` is the request's *unresolved* `AuthConfig` as stored
    /// on disk at send time (still carrying the header/query key name for
    /// static schemes) — used only to find which literal header/query value
    /// in `resolved_request` is auth-derived, so it can be redacted/encrypted
    /// without touching unrelated headers.
    pub fn save(
        &self,
        workspace_id: &str,
        request_id: &str,
        name: String,
        response: HttpResponse,
        resolved_request: HttpRequest,
        original_auth: &AuthConfig,
    ) -> Result<Snapshot, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(request_id)?;
        if response.body.len() > MAX_BODY_BYTES {
            return Err(VoleeoError::InvalidConfig(format!(
                "response body is {} bytes, exceeds the {MAX_BODY_BYTES}-byte saved-snapshot limit",
                response.body.len(),
            )));
        }

        let encrypted = self
            .workspaces
            .get(workspace_id)
            .map(|w| w.encrypted)
            .unwrap_or(false);
        let mut request = resolved_request;
        let mut response = response;
        // A snapshot is a point-in-time capture; the original request's timing
        // and timeline are meaningless later and never shown, so drop both
        // (zeroed timing → skipped from the YAML; empty events likewise).
        response.timing = voleeo_core::HttpTiming::default();
        response.events = Vec::new();

        // `secret_fields_mut()` enumerates every field the auth *type* treats as
        // secret (Bearer token, SigV4 secret key, …) — that's the redaction
        // target regardless of each field's `*_encrypted` bool, which only
        // tracks whether *this stored config* happens to be ciphertext right
        // now. At capture time these are always plaintext (decrypted for
        // signing before the request was sent), so there's nothing to gate on.
        if encrypted {
            // Keyfile only: workspace keys are always written to both keychain
            // and keyfile, and the keychain can block for a minute headless
            // (MCP path) — same policy as `voleeo_mcp::resolve`.
            let key = voleeo_crypto::load_key_from_file(workspace_id, &self.app_data_dir)?;
            for (secret, _) in request.auth.secret_fields_mut() {
                if !voleeo_crypto::is_encrypted(secret) {
                    *secret = voleeo_crypto::encrypt(secret, &key)?;
                }
            }
            treat_static_auth_injection(&mut request, original_auth, |v| {
                voleeo_crypto::encrypt(v, &key)
            })?;
            response.body = voleeo_crypto::encrypt(&response.body, &key)?;
            for h in &mut response.headers {
                h.value = voleeo_crypto::encrypt(&h.value, &key)?;
            }
            // Cookies carry session tokens — ciphertext in git like everything
            // else in the snapshot.
            for c in response
                .captured_cookies
                .iter_mut()
                .chain(response.attached_cookies.iter_mut())
            {
                if !c.value.is_empty() && !voleeo_crypto::is_encrypted(&c.value) {
                    c.value = voleeo_crypto::encrypt(&c.value, &key)?;
                    c.value_encrypted = true;
                }
            }
        } else {
            for (secret, _) in request.auth.secret_fields_mut() {
                *secret = REDACTED.to_string();
            }
            treat_static_auth_injection(&mut request, original_auth, |_| Ok(REDACTED.to_string()))?;
        }

        let id = new_id();
        let snapshot = Snapshot {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            request_id: request_id.to_string(),
            name,
            created_at: Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string(),
            encrypted,
            pinned: false,
            request,
            response,
        };
        let content =
            serde_yaml::to_string(&snapshot).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(self.snapshot_path(workspace_id, &id)?, content)?;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{ApiKeyLocation, HttpResponseHeader, HttpTiming, RequestParameter};

    fn dummy_response(request_id: &str, body: &str) -> HttpResponse {
        HttpResponse {
            request_id: request_id.to_string(),
            status: 200,
            status_text: "OK".to_string(),
            headers: vec![HttpResponseHeader {
                name: "Set-Cookie".into(),
                value: "session=abc".into(),
                at_ms: 0.0,
            }],
            body: body.to_string(),
            body_size: body.len() as u32,
            body_is_text: true,
            body_windowed: false,
            body_line_count: 1,
            response_id: String::new(),
            timing: HttpTiming {
                dns_ms: 0.0,
                connect_ms: 0.0,
                tls_ms: 0.0,
                first_byte_ms: 10.0,
                download_ms: 1.0,
                total_ms: 11.0,
            },
            events: vec![],
            redirect_warning: None,
            captured_cookies: vec![],
            attached_cookies: vec![],
            sse_frames: vec![],
        }
    }

    fn dummy_request(
        request_id: &str,
        workspace_id: &str,
        auth: AuthConfig,
        headers: Vec<RequestParameter>,
    ) -> HttpRequest {
        HttpRequest {
            id: request_id.to_string(),
            request_type: "api".into(),
            model: "http_request".into(),
            workspace_id: workspace_id.to_string(),
            folder_id: None,
            method: "GET".into(),
            name: "Test".into(),
            url: "https://example.com/users?api_key=SECRETVALUE".into(),
            parameters: vec![],
            headers,
            body: None,
            auth,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    fn bearer_header() -> RequestParameter {
        RequestParameter {
            id: "h1".into(),
            name: "Authorization".into(),
            value: "Bearer plaintext-token".into(),
            enabled: true,
        }
    }

    fn store(dir: &std::path::Path) -> (SnapshotStore, WorkspaceStore) {
        let workspaces = WorkspaceStore::new(dir).unwrap();
        let snapshots = SnapshotStore::new(dir, workspaces.clone()).unwrap();
        (snapshots, workspaces)
    }

    #[test]
    fn save_in_unencrypted_workspace_redacts_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();

        let auth = AuthConfig::Bearer {
            token: "plaintext-token".into(),
            token_encrypted: false,
            enabled: true,
        };
        let req = dummy_request("req1", &ws.id, auth.clone(), vec![bearer_header()]);
        let resp = dummy_response("req1", "hello world");

        let snapshot = snapshots
            .save(&ws.id, "req1", "Example".into(), resp, req, &auth)
            .unwrap();

        assert!(!snapshot.encrypted);
        assert_eq!(snapshot.response.body, "hello world"); // response body untouched when unencrypted
        let auth_header = snapshot
            .request
            .headers
            .iter()
            .find(|h| h.name == "Authorization")
            .unwrap();
        assert_eq!(auth_header.value, REDACTED);
        if let AuthConfig::Bearer { token, .. } = &snapshot.request.auth {
            assert_eq!(token, REDACTED);
        } else {
            panic!("expected Bearer auth");
        }
    }

    #[test]
    fn save_in_encrypted_workspace_encrypts_secrets_and_body() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), true).unwrap();
        let key = voleeo_crypto::generate_key();
        voleeo_crypto::save_key(&ws.id, &key, dir.path()).unwrap();

        let auth = AuthConfig::ApiKey {
            key: "api_key".into(),
            value: "SECRETVALUE".into(),
            location: ApiKeyLocation::Query,
            value_encrypted: false,
            enabled: true,
        };
        let req = dummy_request("req1", &ws.id, auth.clone(), vec![]);
        let mut resp = dummy_response("req1", "hello world");
        resp.captured_cookies.push(voleeo_core::StoredCookie {
            id: "c1".into(),
            domain: "example.com".into(),
            host_only: true,
            path: "/".into(),
            name: "session".into(),
            value: "session-token".into(),
            value_encrypted: false,
            secure: false,
            http_only: false,
            same_site: None,
            expires: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        });

        let snapshot = snapshots
            .save(&ws.id, "req1", "Example".into(), resp, req, &auth)
            .unwrap();

        assert!(snapshot.encrypted);
        assert!(voleeo_crypto::is_encrypted(&snapshot.response.body));
        assert_eq!(
            voleeo_crypto::decrypt(&snapshot.response.body, &key).unwrap(),
            "hello world"
        );
        let set_cookie = &snapshot.response.headers[0];
        assert!(voleeo_crypto::is_encrypted(&set_cookie.value));
        // cookie values are session tokens — ciphertext in the snapshot file
        let cookie = &snapshot.response.captured_cookies[0];
        assert!(voleeo_crypto::is_encrypted(&cookie.value));
        assert!(cookie.value_encrypted);
        // the query-string api_key value was ciphertext-swapped in place
        assert!(!snapshot.request.url.contains("SECRETVALUE"));
        assert!(snapshot.request.url.contains("api_key="));
    }

    #[test]
    fn prepare_for_replay_refuses_when_unencrypted_secrets_were_redacted() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();
        let auth = AuthConfig::Bearer {
            token: "plaintext-token".into(),
            token_encrypted: false,
            enabled: true,
        };
        let req = dummy_request("req1", &ws.id, auth.clone(), vec![bearer_header()]);
        let resp = dummy_response("req1", "hello world");
        let snapshot = snapshots
            .save(&ws.id, "req1", "Example".into(), resp, req, &auth)
            .unwrap();

        assert!(has_redacted_secrets(&snapshot));
        let err = snapshots.prepare_for_replay(&ws.id, &snapshot).unwrap_err();
        assert!(matches!(err, VoleeoError::InvalidConfig(_)));
    }

    #[test]
    fn prepare_for_replay_decrypts_encrypted_snapshot_back_to_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), true).unwrap();
        let key = voleeo_crypto::generate_key();
        voleeo_crypto::save_key(&ws.id, &key, dir.path()).unwrap();

        let auth = AuthConfig::Bearer {
            token: "plaintext-token".into(),
            token_encrypted: false,
            enabled: true,
        };
        let req = dummy_request("req1", &ws.id, auth.clone(), vec![bearer_header()]);
        let resp = dummy_response("req1", "hello world");
        let snapshot = snapshots
            .save(&ws.id, "req1", "Example".into(), resp, req, &auth)
            .unwrap();

        assert!(!has_redacted_secrets(&snapshot));
        let (replay_req, cookies) = snapshots.prepare_for_replay(&ws.id, &snapshot).unwrap();
        let auth_header = replay_req
            .headers
            .iter()
            .find(|h| h.name == "Authorization")
            .unwrap();
        assert_eq!(auth_header.value, "Bearer plaintext-token");
        if let AuthConfig::Bearer { token, .. } = &replay_req.auth {
            assert_eq!(token, "plaintext-token");
        } else {
            panic!("expected Bearer auth");
        }
        assert!(cookies.is_empty()); // dummy response attached no cookies
    }

    #[test]
    fn save_rejects_oversized_body() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();
        let big = "x".repeat(MAX_BODY_BYTES + 1);
        let req = dummy_request("req1", &ws.id, AuthConfig::None, vec![]);
        let resp = dummy_response("req1", &big);
        let err = snapshots
            .save(&ws.id, "req1", "Big".into(), resp, req, &AuthConfig::None)
            .unwrap_err();
        assert!(matches!(err, VoleeoError::InvalidConfig(_)));
    }

    #[test]
    fn list_filters_by_request_and_delete_by_request_cascades() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();

        for req_id in ["req1", "req1", "req2"] {
            let req = dummy_request(req_id, &ws.id, AuthConfig::None, vec![]);
            let resp = dummy_response(req_id, "body");
            snapshots
                .save(&ws.id, req_id, "P".into(), resp, req, &AuthConfig::None)
                .unwrap();
        }

        assert_eq!(snapshots.list(&ws.id, "req1").unwrap().len(), 2);
        assert_eq!(snapshots.list(&ws.id, "req2").unwrap().len(), 1);

        let removed = snapshots.delete_by_request(&ws.id, "req1").unwrap();
        assert_eq!(removed, 2);
        assert_eq!(snapshots.list(&ws.id, "req1").unwrap().len(), 0);
        assert_eq!(snapshots.list(&ws.id, "req2").unwrap().len(), 1);
    }

    #[test]
    fn rename_updates_name_only() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();
        let req = dummy_request("req1", &ws.id, AuthConfig::None, vec![]);
        let resp = dummy_response("req1", "body");
        let snapshot = snapshots
            .save(
                &ws.id,
                "req1",
                "Original".into(),
                resp,
                req,
                &AuthConfig::None,
            )
            .unwrap();

        let renamed = snapshots
            .rename(&ws.id, &snapshot.id, "Renamed".into())
            .unwrap();
        assert_eq!(renamed.name, "Renamed");
        assert_eq!(renamed.response.body, snapshot.response.body);
        assert_eq!(snapshots.get(&ws.id, &snapshot.id).unwrap().name, "Renamed");
    }

    #[test]
    fn pinned_snapshots_sort_to_the_top() {
        let dir = tempfile::tempdir().unwrap();
        let (snapshots, workspaces) = store(dir.path());
        let ws = workspaces.create("WS".into(), false).unwrap();

        let mut ids = Vec::new();
        for _ in 0..3 {
            let req = dummy_request("req1", &ws.id, AuthConfig::None, vec![]);
            let resp = dummy_response("req1", "body");
            let p = snapshots
                .save(&ws.id, "req1", "P".into(), resp, req, &AuthConfig::None)
                .unwrap();
            ids.push(p.id);
        }
        // Pin the last-created one — it should jump ahead of the two older ones.
        let pinned = snapshots.set_pinned(&ws.id, &ids[2], true).unwrap();
        assert!(pinned.pinned);

        let listed = snapshots.list(&ws.id, "req1").unwrap();
        assert_eq!(listed[0].id, ids[2]);
        assert!(listed[0].pinned);
        assert_eq!(&[listed[1].id.clone(), listed[2].id.clone()], &ids[0..2]);

        // Unpin restores created-order.
        snapshots.set_pinned(&ws.id, &ids[2], false).unwrap();
        let listed = snapshots.list(&ws.id, "req1").unwrap();
        assert_eq!(listed[0].id, ids[0]);
    }
}
