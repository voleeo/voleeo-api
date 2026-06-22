use super::ApiBackend;
use crate::protocol::ToolResult;
use serde_json::Value;

impl ApiBackend {
    pub(super) async fn workspace_list(&self) -> ToolResult {
        let workspaces = self.workspaces.clone();
        super::run_blocking(move || match workspaces.list() {
            Ok(ws) => ToolResult::json(&ws),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) async fn workspace_create(&self, args: &Value) -> ToolResult {
        let name = require!(args, "name");
        let encrypted = args["encrypted"].as_bool().unwrap_or(false);
        let workspaces = self.workspaces.clone();
        match super::blocking(move || workspaces.create(name, encrypted)).await {
            Ok(ws) => ToolResult::json(&ws),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
