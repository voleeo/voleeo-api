use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use voleeo_cookies::crypto as cookie_crypto;
use voleeo_core::VoleeoError;
use voleeo_http::HttpExecutor;
use voleeo_storage::{
    CookieJarStore, EnvironmentStore, RequestStore, ResponseStore, SelectionStore, WorkspaceStore,
    WsStore, WsTranscriptStore,
};
use voleeo_ws::WsManager;

use crate::protocol::{ToolDef, ToolResult};

/// Return the string value of a required field, or an early-return error ToolResult.
/// Usage: `let val = require!(args, "fieldName");`
macro_rules! require {
    ($args:expr, $key:literal) => {
        match $args[$key].as_str() {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => return ToolResult::error(concat!("missing required field: ", $key)),
        }
    };
}

// Child modules declared after the macro so they can use require! directly.
mod cookie;
mod env;
mod folder;
mod request;
mod response;
mod tools;
mod websocket;
mod workspace;

/// Called after every mutating MCP tool call so the host can push events to
/// the frontend. Keeping this as a callback avoids a Tauri dependency in this crate.
pub type NotifyFn = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// Run a `ToolResult`-producing closure on the blocking pool so YAML/keychain
/// I/O never stalls the async runtime — mirrors `request_send`'s `spawn_blocking`
/// (CLAUDE.md rule #17). On a join panic we surface it as a tool error.
async fn run_blocking(f: impl FnOnce() -> ToolResult + Send + 'static) -> ToolResult {
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => ToolResult::error(format!("Internal error: {e}")),
    }
}

pub struct ApiBackend {
    pub workspaces: WorkspaceStore,
    pub requests: RequestStore,
    pub environments: EnvironmentStore,
    pub cookies: CookieJarStore,
    pub responses: ResponseStore,
    /// Machine-local active cookie jar selection — shared with the app so the
    /// agent sends with the same jar the user has selected (not synced via git).
    pub selections: SelectionStore,
    pub ws: WsStore,
    pub ws_transcripts: WsTranscriptStore,
    pub executor: HttpExecutor,
    pub ws_manager: WsManager,
    /// Emit a Tauri / IPC event to the frontend after a mutation.
    pub notify: NotifyFn,
    /// Used to load workspace encryption keys when resolving encrypted env vars
    /// and decrypting cookie jar values.
    pub app_data_dir: PathBuf,
}

impl ApiBackend {
    pub fn tools(&self) -> Vec<ToolDef> {
        tools::definitions()
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> ToolResult {
        match name {
            "workspace.list" => self.workspace_list().await,
            "workspace.create" => self.workspace_create(&args),
            "request.list" => self.request_list(&args).await,
            "request.get" => self.request_get(&args).await,
            "request.create" => self.request_create(&args),
            "request.update" => self.request_update(&args),
            "request.duplicate" => self.request_duplicate(&args),
            "request.send" => self.request_send(&args).await,
            "folder.create" => self.folder_create(&args),
            "folder.rename" => self.folder_rename(&args),
            "response.list" => self.response_list(&args).await,
            "response.get" => self.response_get(&args).await,
            "env.list" => self.env_list(&args).await,
            "env.get" => self.env_get(&args).await,
            "env.create" => self.env_create(&args),
            "env.set_variable" => self.env_set_variable(&args),
            "cookie.list_jars" => self.cookie_list_jars(&args).await,
            "cookie.get_jar" => self.cookie_get_jar(&args).await,
            "cookie.set_active_jar" => self.cookie_set_active_jar(&args),
            "cookie.set_cookie" => self.cookie_set_cookie(&args),
            "cookie.clear_jar" => self.cookie_clear_jar(&args),
            "websocket.list" => self.ws_list(&args),
            "websocket.create" => self.ws_create(&args),
            "websocket.connect" => self.ws_connect_tool(&args).await,
            "websocket.send" => self.ws_send(&args),
            "websocket.read_messages" => self.ws_read_messages(&args),
            "websocket.disconnect" => self.ws_disconnect(&args),
            _ => ToolResult::error(format!("Unknown tool: {name}")),
        }
    }

    pub(crate) fn notify_requests(&self, workspace_id: &str) {
        (self.notify)(
            "mcp:requests:changed",
            serde_json::json!({ "workspaceId": workspace_id }),
        );
    }

    pub(crate) fn notify_connections(&self, workspace_id: &str) {
        (self.notify)(
            "mcp:connections:changed",
            serde_json::json!({ "workspaceId": workspace_id }),
        );
    }

    pub(crate) fn notify_envs(&self, workspace_id: &str) {
        (self.notify)(
            "mcp:envs:changed",
            serde_json::json!({ "workspaceId": workspace_id }),
        );
    }

    pub(crate) fn notify_cookies(&self, workspace_id: &str) {
        (self.notify)(
            "mcp:cookies:changed",
            serde_json::json!({ "workspaceId": workspace_id }),
        );
    }

    /// Decrypt in-place if the jar carries any `value_encrypted: true` cookies.
    /// Cheap no-op for plaintext-only jars (no keychain round-trip).
    pub(crate) fn decrypt_cookies(
        &self,
        jar: &mut voleeo_core::CookieJar,
    ) -> Result<(), VoleeoError> {
        if !cookie_crypto::jar_needs_key(&jar.cookies) {
            return Ok(());
        }
        let ws = self.workspaces.get(&jar.workspace_id)?;
        if !ws.encrypted {
            return Err(VoleeoError::InvalidConfig(
                "workspace_encryption_required".to_string(),
            ));
        }
        let key = voleeo_crypto::load_key(&jar.workspace_id, &self.app_data_dir)?;
        cookie_crypto::decrypt_values(&mut jar.cookies, &key)
    }

    /// Encrypt in-place when the jar carries `value_encrypted: true` cookies.
    pub(crate) fn encrypt_cookies(
        &self,
        jar: &mut voleeo_core::CookieJar,
    ) -> Result<(), VoleeoError> {
        if !cookie_crypto::jar_needs_key(&jar.cookies) {
            return Ok(());
        }
        let ws = self.workspaces.get(&jar.workspace_id)?;
        if !ws.encrypted {
            return Err(VoleeoError::InvalidConfig(
                "workspace_encryption_required".to_string(),
            ));
        }
        let key = voleeo_crypto::load_key(&jar.workspace_id, &self.app_data_dir)?;
        cookie_crypto::encrypt_values(&mut jar.cookies, &key)
    }
}

#[cfg(test)]
mod tests {
    use super::ApiBackend;
    use serde_json::Value;
    use std::sync::Arc;
    use voleeo_http::HttpExecutor;
    use voleeo_storage::{
        CookieJarStore, EnvironmentStore, RequestStore, ResponseStore, SelectionStore,
        WorkspaceStore, WsStore, WsTranscriptStore,
    };
    use voleeo_ws::WsManager;

    fn make_backend(dir: &tempfile::TempDir) -> ApiBackend {
        ApiBackend {
            workspaces: WorkspaceStore::new(dir.path()).unwrap(),
            requests: RequestStore::new(dir.path()).unwrap(),
            environments: EnvironmentStore::new(dir.path()).unwrap(),
            cookies: CookieJarStore::new(dir.path()).unwrap(),
            responses: ResponseStore::new(dir.path()).unwrap(),
            selections: SelectionStore::new(dir.path()).unwrap(),
            ws: WsStore::new(dir.path()).unwrap(),
            ws_transcripts: WsTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            notify: Arc::new(|_, _| {}),
            app_data_dir: dir.path().to_path_buf(),
        }
    }

    fn args(pairs: &[(&str, serde_json::Value)]) -> Value {
        let mut map = serde_json::Map::new();
        for (k, v) in pairs {
            map.insert(k.to_string(), v.clone());
        }
        Value::Object(map)
    }

    #[tokio::test]
    async fn missing_required_field_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b.call_tool("workspace.create", args(&[])).await;
        assert_eq!(result.is_error, Some(true));
        assert!(
            result.content[0].text.contains("name"),
            "error should mention the missing field"
        );
    }

    #[tokio::test]
    async fn empty_string_for_required_field_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b
            .call_tool(
                "workspace.create",
                args(&[("name", Value::String(String::new()))]),
            )
            .await;
        assert_eq!(result.is_error, Some(true));
    }

    #[tokio::test]
    async fn unknown_tool_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b.call_tool("nonexistent", args(&[])).await;
        assert_eq!(result.is_error, Some(true));
        assert!(result.content[0].text.contains("Unknown tool"));
    }

    #[tokio::test]
    async fn workspace_list_empty() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b.call_tool("workspace.list", args(&[])).await;
        assert!(result.is_error.is_none());
        let v: Vec<Value> = serde_json::from_str(&result.content[0].text).unwrap();
        assert!(v.is_empty());
    }

    #[tokio::test]
    async fn workspace_create_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let created = b
            .call_tool(
                "workspace.create",
                args(&[("name", Value::String("My API".into()))]),
            )
            .await;
        assert!(created.is_error.is_none(), "create should succeed");
        let ws: Value = serde_json::from_str(&created.content[0].text).unwrap();
        assert_eq!(ws["name"], "My API");

        let listed = b.call_tool("workspace.list", args(&[])).await;
        let list: Vec<Value> = serde_json::from_str(&listed.content[0].text).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "My API");
    }

    #[tokio::test]
    async fn request_create_get_list() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();

        let created = b
            .call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("Get Users".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://api.example.com/users".into())),
                ]),
            )
            .await;
        assert!(
            created.is_error.is_none(),
            "create should succeed: {:?}",
            created.content[0].text
        );
        let req: Value = serde_json::from_str(&created.content[0].text).unwrap();
        let req_id = req["id"].as_str().unwrap();
        assert_eq!(req["method"], "GET");

        let got = b
            .call_tool(
                "request.get",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("requestId", Value::String(req_id.into())),
                ]),
            )
            .await;
        assert!(got.is_error.is_none());
        let got_req: Value = serde_json::from_str(&got.content[0].text).unwrap();
        assert_eq!(got_req["id"], req_id);

        let listed = b
            .call_tool(
                "request.list",
                args(&[("workspaceId", Value::String(ws_id.into()))]),
            )
            .await;
        let tree: Value = serde_json::from_str(&listed.content[0].text).unwrap();
        assert_eq!(tree["requests"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn request_get_missing_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b
            .call_tool(
                "request.get",
                args(&[
                    ("workspaceId", Value::String("ws1".into())),
                    ("requestId", Value::String("nonexistent".into())),
                ]),
            )
            .await;
        assert_eq!(result.is_error, Some(true));
    }

    #[tokio::test]
    async fn request_update_changes_method_and_url() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();
        let req: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://old.example.com".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let req_id = req["id"].as_str().unwrap();

        let updated = b
            .call_tool(
                "request.update",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("requestId", Value::String(req_id.into())),
                    ("method", Value::String("POST".into())),
                    ("url", Value::String("https://new.example.com".into())),
                ]),
            )
            .await;
        assert!(updated.is_error.is_none());
        let u: Value = serde_json::from_str(&updated.content[0].text).unwrap();
        assert_eq!(u["method"], "POST");
        assert_eq!(u["url"], "https://new.example.com");
    }

    #[tokio::test]
    async fn request_duplicate_creates_copy() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();
        let req: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("Original".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://example.com".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let req_id = req["id"].as_str().unwrap();

        let dup = b
            .call_tool(
                "request.duplicate",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("requestId", Value::String(req_id.into())),
                ]),
            )
            .await;
        assert!(dup.is_error.is_none());
        let dup_req: Value = serde_json::from_str(&dup.content[0].text).unwrap();
        assert_ne!(dup_req["id"], req_id, "duplicate must have a new id");
        assert_eq!(dup_req["url"], "https://example.com");
    }

    #[tokio::test]
    async fn folder_create_and_rename() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();

        let created = b
            .call_tool(
                "folder.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("Auth".into())),
                ]),
            )
            .await;
        assert!(created.is_error.is_none());
        let folder: Value = serde_json::from_str(&created.content[0].text).unwrap();
        let folder_id = folder["id"].as_str().unwrap();
        assert_eq!(folder["name"], "Auth");

        let renamed = b
            .call_tool(
                "folder.rename",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("folderId", Value::String(folder_id.into())),
                    ("name", Value::String("Security".into())),
                ]),
            )
            .await;
        assert!(renamed.is_error.is_none());
    }

    #[tokio::test]
    async fn env_create_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();

        let created = b
            .call_tool(
                "env.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("Dev".into())),
                    ("color", Value::String("#ff0000".into())),
                ]),
            )
            .await;
        assert!(created.is_error.is_none());
        let env: Value = serde_json::from_str(&created.content[0].text).unwrap();
        let env_id = env["id"].as_str().unwrap();

        let listed = b
            .call_tool(
                "env.list",
                args(&[("workspaceId", Value::String(ws_id.into()))]),
            )
            .await;
        let envs: Vec<Value> = serde_json::from_str(&listed.content[0].text).unwrap();
        assert!(envs.iter().any(|e| e["id"] == env_id));
    }

    #[tokio::test]
    async fn env_set_variable_creates_then_updates() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws: Value = serde_json::from_str(
            &b.call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let ws_id = ws["id"].as_str().unwrap();
        let env: Value = serde_json::from_str(
            &b.call_tool(
                "env.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("Dev".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let env_id = env["id"].as_str().unwrap();

        let r = b
            .call_tool(
                "env.set_variable",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("envId", Value::String(env_id.into())),
                    ("key", Value::String("TOKEN".into())),
                    ("value", Value::String("abc".into())),
                ]),
            )
            .await;
        assert!(r.is_error.is_none());
        let updated: Value = serde_json::from_str(&r.content[0].text).unwrap();
        let vars = updated["variables"].as_array().unwrap();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0]["key"], "TOKEN");
        assert_eq!(vars[0]["value"], "abc");

        let r2 = b
            .call_tool(
                "env.set_variable",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("envId", Value::String(env_id.into())),
                    ("key", Value::String("TOKEN".into())),
                    ("value", Value::String("xyz".into())),
                ]),
            )
            .await;
        assert!(r2.is_error.is_none());
        let updated2: Value = serde_json::from_str(&r2.content[0].text).unwrap();
        let vars2 = updated2["variables"].as_array().unwrap();
        assert_eq!(
            vars2.len(),
            1,
            "should update in place, not add a second entry"
        );
        assert_eq!(vars2[0]["value"], "xyz");
    }

    #[tokio::test]
    async fn response_list_empty_for_new_request() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b
            .call_tool(
                "response.list",
                args(&[
                    ("workspaceId", Value::String("ws1".into())),
                    ("requestId", Value::String("req1".into())),
                ]),
            )
            .await;
        assert!(result.is_error.is_none());
        let list: Vec<Value> = serde_json::from_str(&result.content[0].text).unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn response_get_missing_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let result = b
            .call_tool(
                "response.get",
                args(&[
                    ("workspaceId", Value::String("ws1".into())),
                    ("requestId", Value::String("req1".into())),
                    ("responseId", Value::String("nonexistent".into())),
                ]),
            )
            .await;
        assert_eq!(result.is_error, Some(true));
    }

    // ---------- cookie tools ----------

    /// Helper: create a workspace, return its id.
    async fn ws(b: &ApiBackend) -> String {
        let created = b
            .call_tool(
                "workspace.create",
                args(&[("name", Value::String("WS".into()))]),
            )
            .await;
        let v: Value = serde_json::from_str(&created.content[0].text).unwrap();
        v["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn cookie_list_jars_auto_creates_default() {
        // A fresh workspace has no jar files on disk; list should auto-create
        // the default jar so the AI never sees a workspace with zero jars.
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let result = b
            .call_tool(
                "cookie.list_jars",
                args(&[("workspaceId", Value::String(ws_id))]),
            )
            .await;
        assert!(result.is_error.is_none());
        let jars: Vec<Value> = serde_json::from_str(&result.content[0].text).unwrap();
        assert_eq!(jars.len(), 1);
        assert_eq!(jars[0]["id"], "default");
        assert_eq!(jars[0]["cookies"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn cookie_set_cookie_then_get_jar_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;

        let set = b
            .call_tool(
                "cookie.set_cookie",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("jarId", Value::String("default".into())),
                    ("domain", Value::String("api.example.com".into())),
                    ("name", Value::String("SESSION".into())),
                    ("value", Value::String("abc123".into())),
                ]),
            )
            .await;
        assert!(set.is_error.is_none(), "{}", set.content[0].text);
        let saved: Value = serde_json::from_str(&set.content[0].text).unwrap();
        assert_eq!(saved["name"], "SESSION");
        assert_eq!(saved["value"], "abc123");
        assert_eq!(saved["path"], "/");
        assert_eq!(saved["hostOnly"], true);

        let got = b
            .call_tool(
                "cookie.get_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("jarId", Value::String("default".into())),
                ]),
            )
            .await;
        let jar: Value = serde_json::from_str(&got.content[0].text).unwrap();
        let cookies = jar["cookies"].as_array().unwrap();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0]["value"], "abc123");
    }

    #[tokio::test]
    async fn cookie_set_cookie_upserts_by_identity() {
        // (domain, path, name) is the RFC 6265 identity — re-setting the same
        // tuple must update in place, not append a duplicate.
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;

        for v in ["v1", "v2", "v3"] {
            let r = b
                .call_tool(
                    "cookie.set_cookie",
                    args(&[
                        ("workspaceId", Value::String(ws_id.clone())),
                        ("jarId", Value::String("default".into())),
                        ("domain", Value::String("example.com".into())),
                        ("name", Value::String("X".into())),
                        ("value", Value::String(v.into())),
                    ]),
                )
                .await;
            assert!(r.is_error.is_none());
        }
        let got = b
            .call_tool(
                "cookie.get_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("jarId", Value::String("default".into())),
                ]),
            )
            .await;
        let jar: Value = serde_json::from_str(&got.content[0].text).unwrap();
        let cookies = jar["cookies"].as_array().unwrap();
        assert_eq!(cookies.len(), 1, "upsert must collapse to a single entry");
        assert_eq!(cookies[0]["value"], "v3");
    }

    #[tokio::test]
    async fn cookie_clear_jar_empties_cookies() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        b.call_tool(
            "cookie.set_cookie",
            args(&[
                ("workspaceId", Value::String(ws_id.clone())),
                ("jarId", Value::String("default".into())),
                ("domain", Value::String("example.com".into())),
                ("name", Value::String("X".into())),
                ("value", Value::String("v".into())),
            ]),
        )
        .await;

        let cleared = b
            .call_tool(
                "cookie.clear_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("jarId", Value::String("default".into())),
                ]),
            )
            .await;
        assert!(cleared.is_error.is_none());
        let jar: Value = serde_json::from_str(&cleared.content[0].text).unwrap();
        assert_eq!(jar["cookies"].as_array().unwrap().len(), 0);

        // Idempotence: clearing again on an empty jar still succeeds.
        let again = b
            .call_tool(
                "cookie.clear_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("jarId", Value::String("default".into())),
                ]),
            )
            .await;
        assert!(again.is_error.is_none());
    }

    #[tokio::test]
    async fn cookie_set_active_jar_updates_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        // Force the default jar to materialize.
        b.cookies.ensure_default(&ws_id).unwrap();
        let other = b.cookies.create(ws_id.clone(), "Other".into()).unwrap();

        let r = b
            .call_tool(
                "cookie.set_active_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("jarId", Value::String(other.id.clone())),
                ]),
            )
            .await;
        assert!(r.is_error.is_none(), "{}", r.content[0].text);
        let res: Value = serde_json::from_str(&r.content[0].text).unwrap();
        assert_eq!(res["activeJarId"], other.id);
        // Persisted to the machine-local selection store (not workspace.yaml).
        assert_eq!(b.selections.active_jar(&ws_id), Some(other.id));
    }

    #[tokio::test]
    async fn cookie_set_active_jar_rejects_unknown_id() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let r = b
            .call_tool(
                "cookie.set_active_jar",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("jarId", Value::String("jar_does_not_exist".into())),
                ]),
            )
            .await;
        assert_eq!(r.is_error, Some(true));
    }

    #[tokio::test]
    async fn cookie_set_cookie_rejects_invalid_same_site() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let r = b
            .call_tool(
                "cookie.set_cookie",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("jarId", Value::String("default".into())),
                    ("domain", Value::String("example.com".into())),
                    ("name", Value::String("X".into())),
                    ("value", Value::String("v".into())),
                    ("sameSite", Value::String("bogus".into())),
                ]),
            )
            .await;
        assert_eq!(r.is_error, Some(true));
        assert!(r.content[0].text.contains("sameSite"));
    }

    #[tokio::test]
    async fn cookie_change_notifies() {
        // Mutations emit `mcp:cookies:changed` so the frontend reloads.
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let count_clone = count.clone();
        let b = ApiBackend {
            workspaces: WorkspaceStore::new(dir.path()).unwrap(),
            requests: RequestStore::new(dir.path()).unwrap(),
            environments: EnvironmentStore::new(dir.path()).unwrap(),
            cookies: CookieJarStore::new(dir.path()).unwrap(),
            responses: ResponseStore::new(dir.path()).unwrap(),
            selections: SelectionStore::new(dir.path()).unwrap(),
            ws: WsStore::new(dir.path()).unwrap(),
            ws_transcripts: WsTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            notify: Arc::new(move |event, _payload| {
                if event == "mcp:cookies:changed" {
                    count_clone.fetch_add(1, Ordering::SeqCst);
                }
            }),
            app_data_dir: dir.path().to_path_buf(),
        };
        let ws_id = ws(&b).await;
        b.call_tool(
            "cookie.set_cookie",
            args(&[
                ("workspaceId", Value::String(ws_id.clone())),
                ("jarId", Value::String("default".into())),
                ("domain", Value::String("example.com".into())),
                ("name", Value::String("X".into())),
                ("value", Value::String("v".into())),
            ]),
        )
        .await;
        b.call_tool(
            "cookie.clear_jar",
            args(&[
                ("workspaceId", Value::String(ws_id)),
                ("jarId", Value::String("default".into())),
            ]),
        )
        .await;
        assert_eq!(
            count.load(Ordering::SeqCst),
            2,
            "set + clear each fire once"
        );
    }
}
