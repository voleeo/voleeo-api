use super::ApiBackend;
use crate::protocol::ToolResult;
use serde_json::Value;

impl ApiBackend {
    pub(super) async fn response_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let responses = self.responses.clone();
        super::run_blocking(move || match responses.list(&ws_id, &req_id) {
            Ok(list) => ToolResult::json(&list),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) async fn response_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let resp_id = require!(args, "responseId");
        let responses = self.responses.clone();
        super::run_blocking(move || match responses.get(&ws_id, &req_id, &resp_id) {
            Ok(Some(r)) => ToolResult::json(&r),
            Ok(None) => ToolResult::error("Response not found"),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }
}
