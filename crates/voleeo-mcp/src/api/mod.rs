use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use voleeo_core::VoleeoError;
use voleeo_grpc::{DescriptorCache, GrpcExecutor, GrpcManager};
use voleeo_http::HttpExecutor;
use voleeo_storage::{
    CookieJarStore, EnvironmentStore, GrpcResponseStore, GrpcStore, GrpcTranscriptStore,
    RequestStore, ResponseStore, SelectionStore, WorkspaceStore, WsStore, WsTranscriptStore,
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
mod grpc;
mod redact;
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

/// Run mutating store / crypto work off the async runtime, returning its
/// `Result` so the caller can `notify` + serialize back on the runtime. Keeps
/// `std::fs` and keychain I/O off the runtime worker threads (CLAUDE.md
/// #17/#19) — the write-side counterpart to `run_blocking`.
async fn blocking<T, F>(f: F) -> Result<T, VoleeoError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, VoleeoError> + Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(VoleeoError::Storage(format!("internal task error: {e}"))),
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
    pub grpc: GrpcStore,
    pub grpc_responses: GrpcResponseStore,
    pub grpc_transcripts: GrpcTranscriptStore,
    pub executor: HttpExecutor,
    pub ws_manager: WsManager,
    pub grpc_executor: GrpcExecutor,
    pub grpc_manager: GrpcManager,
    pub grpc_descriptors: DescriptorCache,
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
            "workspace.create" => self.workspace_create(&args).await,
            "request.list" => self.request_list(&args).await,
            "request.get" => self.request_get(&args).await,
            "request.create" => self.request_create(&args).await,
            "request.update" => self.request_update(&args).await,
            "request.duplicate" => self.request_duplicate(&args).await,
            "request.delete" => self.request_delete(&args).await,
            "request.send" => self.request_send(&args).await,
            "folder.create" => self.folder_create(&args).await,
            "folder.rename" => self.folder_rename(&args).await,
            "folder.delete" => self.folder_delete(&args).await,
            "response.list" => self.response_list(&args).await,
            "response.get" => self.response_get(&args).await,
            "env.list" => self.env_list(&args).await,
            "env.create" => self.env_create(&args).await,
            "env.set_variable" => self.env_set_variable(&args).await,
            "env.delete" => self.env_delete(&args).await,
            "cookie.list_jars" => self.cookie_list_jars(&args).await,
            "cookie.set_active_jar" => self.cookie_set_active_jar(&args).await,
            "cookie.set_cookie" => self.cookie_set_cookie(&args).await,
            "cookie.clear_jar" => self.cookie_clear_jar(&args).await,
            "websocket.list" => self.ws_list(&args).await,
            "websocket.create" => self.ws_create(&args).await,
            "websocket.connect" => self.ws_connect_tool(&args).await,
            "websocket.send" => self.ws_send(&args).await,
            "websocket.read_messages" => self.ws_read_messages(&args).await,
            "websocket.disconnect" => self.ws_disconnect(&args).await,
            "websocket.delete" => self.ws_delete(&args).await,
            "grpc.list" => self.grpc_list(&args).await,
            "grpc.create" => self.grpc_create(&args).await,
            "grpc.describe" => self.grpc_describe(&args).await,
            "grpc.call" => self.grpc_call_tool(&args).await,
            "grpc.stream_start" => self.grpc_stream_start_tool(&args).await,
            "grpc.stream_send" => self.grpc_stream_send_tool(&args).await,
            "grpc.stream_read" => self.grpc_stream_read(&args).await,
            "grpc.stream_close" => self.grpc_stream_close(&args).await,
            "grpc.delete" => self.grpc_delete(&args).await,
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

    pub(crate) fn notify_grpc(&self, workspace_id: &str) {
        (self.notify)(
            "mcp:grpc:changed",
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
}

#[cfg(test)]
mod tests {
    use super::ApiBackend;
    use serde_json::Value;
    use std::sync::Arc;
    use voleeo_grpc::{DescriptorCache, GrpcExecutor, GrpcManager};
    use voleeo_http::HttpExecutor;
    use voleeo_storage::{
        CookieJarStore, EnvironmentStore, GrpcResponseStore, GrpcStore, GrpcTranscriptStore,
        RequestStore, ResponseStore, SelectionStore, WorkspaceStore, WsStore, WsTranscriptStore,
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
            grpc: GrpcStore::new(dir.path()).unwrap(),
            grpc_responses: GrpcResponseStore::new(dir.path()).unwrap(),
            grpc_transcripts: GrpcTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            grpc_executor: GrpcExecutor::new(),
            grpc_manager: GrpcManager::new(),
            grpc_descriptors: DescriptorCache::new(),
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
    async fn request_update_sets_graphql_body() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let req: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("Gql".into())),
                    ("method", Value::String("GET".into())),
                    (
                        "url",
                        Value::String("https://api.example.com/graphql".into()),
                    ),
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
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("requestId", Value::String(req_id.into())),
                    ("graphqlQuery", Value::String("query { me { id } }".into())),
                    ("graphqlVariables", Value::String(r#"{"x":1}"#.into())),
                ]),
            )
            .await;
        assert!(updated.is_error.is_none(), "{}", updated.content[0].text);
        let u: Value = serde_json::from_str(&updated.content[0].text).unwrap();
        // GraphQL body set, and the GET was auto-switched to POST.
        assert_eq!(u["method"], "POST");
        assert_eq!(u["body"]["kind"], "graphql");
        assert_eq!(u["body"]["text"], "query { me { id } }");
        assert_eq!(u["body"]["graphqlVariables"], r#"{"x":1}"#);
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
        // Values are masked by default, even in a write tool's echo-back.
        assert_eq!(vars[0]["value"], super::redact::MASK);

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

        // reveal=true exposes the real persisted value (via env.list).
        let envs: Value = serde_json::from_str(
            &b.call_tool(
                "env.list",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("reveal", Value::Bool(true)),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let env = envs
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == env_id)
            .unwrap();
        assert_eq!(env["variables"][0]["value"], "xyz");
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
                "cookie.list_jars",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("reveal", Value::Bool(true)),
                ]),
            )
            .await;
        let jars: Value = serde_json::from_str(&got.content[0].text).unwrap();
        let jar = jars
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == "default")
            .unwrap();
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
                "cookie.list_jars",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("reveal", Value::Bool(true)),
                ]),
            )
            .await;
        let jars: Value = serde_json::from_str(&got.content[0].text).unwrap();
        let jar = jars
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == "default")
            .unwrap();
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

    // ---------- gRPC tools ----------

    #[tokio::test]
    async fn grpc_create_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let created = b
            .call_tool(
                "grpc.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("Greeter".into())),
                    ("target", Value::String("localhost:50051".into())),
                ]),
            )
            .await;
        assert!(created.is_error.is_none(), "{}", created.content[0].text);
        let g: Value = serde_json::from_str(&created.content[0].text).unwrap();
        assert_eq!(g["model"], "grpc_request");

        let listed = b
            .call_tool("grpc.list", args(&[("workspaceId", Value::String(ws_id))]))
            .await;
        let list: Vec<Value> = serde_json::from_str(&listed.content[0].text).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["target"], "localhost:50051");
    }

    #[tokio::test]
    async fn grpc_describe_unreachable_target_errors_cleanly() {
        // No server on this port → reflection connect fails with a tool error
        // (not a panic). Verifies the descriptor path is wired end to end.
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let created = b
            .call_tool(
                "grpc.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("G".into())),
                    ("target", Value::String("127.0.0.1:1".into())),
                ]),
            )
            .await;
        let g: Value = serde_json::from_str(&created.content[0].text).unwrap();
        let id = g["id"].as_str().unwrap();
        let described = b
            .call_tool(
                "grpc.describe",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("id", Value::String(id.into())),
                ]),
            )
            .await;
        assert_eq!(described.is_error, Some(true));
    }

    #[tokio::test]
    async fn grpc_call_persists_selection_and_notifies() {
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
            grpc: GrpcStore::new(dir.path()).unwrap(),
            grpc_responses: GrpcResponseStore::new(dir.path()).unwrap(),
            grpc_transcripts: GrpcTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            grpc_executor: GrpcExecutor::new(),
            grpc_manager: GrpcManager::new(),
            grpc_descriptors: DescriptorCache::new(),
            notify: Arc::new(move |event, _payload| {
                if event == "mcp:grpc:changed" {
                    count_clone.fetch_add(1, Ordering::SeqCst);
                }
            }),
            app_data_dir: dir.path().to_path_buf(),
        };
        let ws_id = ws(&b).await;
        let created = b
            .call_tool(
                "grpc.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("Greeter".into())),
                    ("target", Value::String("127.0.0.1:1".into())),
                ]),
            )
            .await;
        let g: Value = serde_json::from_str(&created.content[0].text).unwrap();
        let id = g["id"].as_str().unwrap().to_string();
        let after_create = count.load(Ordering::SeqCst);

        let called = b
            .call_tool(
                "grpc.call",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("id", Value::String(id.clone())),
                    ("service", Value::String("helloworld.Greeter".into())),
                    ("method", Value::String("SayHello".into())),
                ]),
            )
            .await;
        assert_eq!(
            called.is_error,
            Some(true),
            "call without a server should fail at resolution"
        );

        let listed = b
            .call_tool("grpc.list", args(&[("workspaceId", Value::String(ws_id))]))
            .await;
        let list: Vec<Value> = serde_json::from_str(&listed.content[0].text).unwrap();
        let stored = list.iter().find(|x| x["id"] == id.as_str()).unwrap();
        assert_eq!(stored["service"], "helloworld.Greeter", "service persisted");
        assert_eq!(stored["method"], "SayHello", "method persisted");
        assert!(
            count.load(Ordering::SeqCst) > after_create,
            "grpc.call should emit mcp:grpc:changed"
        );
    }

    #[tokio::test]
    async fn request_update_sets_auth_and_notifies() {
        // The agent can set request auth via request.update; it persists and emits
        // `mcp:requests:changed` so the open AUTH tab refreshes. Regression: there
        // was no way to set auth through MCP at all.
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
            grpc: GrpcStore::new(dir.path()).unwrap(),
            grpc_responses: GrpcResponseStore::new(dir.path()).unwrap(),
            grpc_transcripts: GrpcTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            grpc_executor: GrpcExecutor::new(),
            grpc_manager: GrpcManager::new(),
            grpc_descriptors: DescriptorCache::new(),
            notify: Arc::new(move |event, _payload| {
                if event == "mcp:requests:changed" {
                    count_clone.fetch_add(1, Ordering::SeqCst);
                }
            }),
            app_data_dir: dir.path().to_path_buf(),
        };
        let ws_id = ws(&b).await;
        let created: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://example.com".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let req_id = created["id"].as_str().unwrap().to_string();
        let before = count.load(Ordering::SeqCst);

        let updated = b
            .call_tool(
                "request.update",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("requestId", Value::String(req_id.clone())),
                    (
                        "auth",
                        serde_json::json!({ "kind": "bearer", "token": "s3cr3t" }),
                    ),
                ]),
            )
            .await;
        assert!(updated.is_error.is_none(), "{}", updated.content[0].text);
        assert!(
            count.load(Ordering::SeqCst) > before,
            "auth update should emit mcp:requests:changed"
        );

        let got: Value = serde_json::from_str(
            &b.call_tool(
                "request.get",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("requestId", Value::String(req_id)),
                    ("reveal", Value::Bool(true)),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        assert_eq!(got["auth"]["kind"], "bearer");
        assert_eq!(got["auth"]["token"], "s3cr3t");
    }

    #[tokio::test]
    async fn request_get_masks_auth_and_survives_masked_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let created: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://example.com".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let req_id = created["id"].as_str().unwrap().to_string();
        b.call_tool(
            "request.update",
            args(&[
                ("workspaceId", Value::String(ws_id.clone())),
                ("requestId", Value::String(req_id.clone())),
                (
                    "auth",
                    serde_json::json!({ "kind": "bearer", "token": "s3cr3t" }),
                ),
            ]),
        )
        .await;

        // Default read masks the secret.
        let masked: Value = serde_json::from_str(
            &b.call_tool(
                "request.get",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("requestId", Value::String(req_id.clone())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        assert_eq!(masked["auth"]["token"], super::redact::MASK);

        // Echoing the masked value back on update must NOT wipe the real secret.
        b.call_tool(
            "request.update",
            args(&[
                ("workspaceId", Value::String(ws_id.clone())),
                ("requestId", Value::String(req_id.clone())),
                (
                    "auth",
                    serde_json::json!({ "kind": "bearer", "token": super::redact::MASK }),
                ),
            ]),
        )
        .await;
        let revealed: Value = serde_json::from_str(
            &b.call_tool(
                "request.get",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("requestId", Value::String(req_id)),
                    ("reveal", Value::Bool(true)),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        assert_eq!(
            revealed["auth"]["token"], "s3cr3t",
            "masked round-trip must preserve the stored secret"
        );
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
            grpc: GrpcStore::new(dir.path()).unwrap(),
            grpc_responses: GrpcResponseStore::new(dir.path()).unwrap(),
            grpc_transcripts: GrpcTranscriptStore::new(dir.path()).unwrap(),
            executor: HttpExecutor::new().unwrap(),
            ws_manager: WsManager::new(),
            grpc_executor: GrpcExecutor::new(),
            grpc_manager: GrpcManager::new(),
            grpc_descriptors: DescriptorCache::new(),
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

    async fn create_req(b: &ApiBackend, ws_id: &str) -> String {
        let created: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.into())),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("GET".into())),
                    ("url", Value::String("https://example.com".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        created["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn request_create_with_headers_query_and_body() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let created: Value = serde_json::from_str(
            &b.call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("POST".into())),
                    ("url", Value::String("https://example.com".into())),
                    (
                        "headers",
                        serde_json::json!({ "X-Test": "1", "Accept": "application/json" }),
                    ),
                    ("queryParams", serde_json::json!({ "q": "hello" })),
                    (
                        "body",
                        serde_json::json!({ "kind": "json", "text": "{\"a\":1}" }),
                    ),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let headers = created["headers"].as_array().unwrap();
        assert_eq!(headers.len(), 2);
        assert!(headers
            .iter()
            .any(|h| h["name"] == "X-Test" && h["value"] == "1"));
        assert_eq!(created["parameters"].as_array().unwrap().len(), 1);
        assert_eq!(created["body"]["kind"], "json");
        assert_eq!(created["body"]["text"], "{\"a\":1}");
    }

    #[tokio::test]
    async fn request_create_rejects_unknown_body_kind() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let r = b
            .call_tool(
                "request.create",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("name", Value::String("R".into())),
                    ("method", Value::String("POST".into())),
                    ("url", Value::String("https://example.com".into())),
                    ("body", serde_json::json!({ "kind": "multipart" })),
                ]),
            )
            .await;
        assert_eq!(r.is_error, Some(true));
    }

    #[tokio::test]
    async fn request_delete_removes_request() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let req_id = create_req(&b, &ws_id).await;
        let del = b
            .call_tool(
                "request.delete",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("requestId", Value::String(req_id)),
                ]),
            )
            .await;
        assert!(del.is_error.is_none(), "{}", del.content[0].text);
        let list: Value = serde_json::from_str(
            &b.call_tool(
                "request.list",
                args(&[("workspaceId", Value::String(ws_id))]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        assert_eq!(list["requests"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn env_set_variable_delete_removes_var() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let env: Value = serde_json::from_str(
            &b.call_tool(
                "env.create",
                args(&[
                    ("workspaceId", Value::String(ws_id.clone())),
                    ("name", Value::String("Dev".into())),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        let env_id = env["id"].as_str().unwrap().to_string();
        b.call_tool(
            "env.set_variable",
            args(&[
                ("workspaceId", Value::String(ws_id.clone())),
                ("envId", Value::String(env_id.clone())),
                ("key", Value::String("TOKEN".into())),
                ("value", Value::String("abc".into())),
            ]),
        )
        .await;
        let after: Value = serde_json::from_str(
            &b.call_tool(
                "env.set_variable",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("envId", Value::String(env_id)),
                    ("key", Value::String("TOKEN".into())),
                    ("delete", Value::Bool(true)),
                ]),
            )
            .await
            .content[0]
                .text,
        )
        .unwrap();
        assert_eq!(after["variables"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn env_delete_rejects_global() {
        let dir = tempfile::tempdir().unwrap();
        let b = make_backend(&dir);
        let ws_id = ws(&b).await;
        let r = b
            .call_tool(
                "env.delete",
                args(&[
                    ("workspaceId", Value::String(ws_id)),
                    ("envId", Value::String("global".into())),
                ]),
            )
            .await;
        assert_eq!(r.is_error, Some(true));
    }
}
