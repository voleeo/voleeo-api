use super::ApiBackend;
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::{ItemKind, MoveItemUpdate};

impl ApiBackend {
    pub(super) async fn folder_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let folder_id = args["folderId"].as_str().map(str::to_string);
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        match super::blocking(move || requests.create_folder(ws, folder_id, name)).await {
            Ok(f) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&f)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn folder_rename(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let folder_id = require!(args, "folderId");
        let name = require!(args, "name");
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        // Return the updated folder JSON (not bare text) for a uniform contract.
        let result = super::blocking(move || {
            requests.rename_folder(&ws, &folder_id, name)?;
            requests.get_folder(&ws, &folder_id)
        })
        .await;
        match result {
            Ok(folder) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&folder)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn folder_delete(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let folder_id = require!(args, "folderId");
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        let fid = folder_id.clone();
        // Cascade: removes the folder and every request/subfolder inside it
        // (mirrors the desktop's folder delete).
        match super::blocking(move || requests.delete_folder_cascade(&ws, &fid)).await {
            Ok(()) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&serde_json::json!({ "deleted": folder_id }))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn item_move(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let Ok(kind) = serde_json::from_value::<ItemKind>(args["kind"].clone()) else {
            return ToolResult::error("kind must be one of: request, folder, webSocket, grpc");
        };
        let folder_id = args["folderId"].as_str().map(str::to_string);
        let update = MoveItemUpdate {
            id: id.clone(),
            kind: kind.clone(),
            folder_id: folder_id.clone(),
            // Same "now" order new items get on create → lands last among siblings.
            order: chrono::Utc::now().timestamp_millis() as f64,
        };
        let (requests, ws, grpc) = (self.requests.clone(), self.ws.clone(), self.grpc.clone());
        let w = ws_id.clone();
        match super::blocking(move || requests.move_items(&ws, &grpc, &w, vec![update])).await {
            Ok(()) => {
                match kind {
                    ItemKind::WebSocket => self.notify_connections(&ws_id),
                    ItemKind::Grpc => self.notify_grpc(&ws_id),
                    ItemKind::Request | ItemKind::Folder => self.notify_requests(&ws_id),
                }
                ToolResult::json(
                    &serde_json::json!({ "id": id, "kind": kind, "folderId": folder_id }),
                )
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
