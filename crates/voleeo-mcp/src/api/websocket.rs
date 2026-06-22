//! WebSocket MCP tools. Mirrors `request.rs`: the agent can list/create
//! connections, open them, send messages, and read the transcript. Live frames
//! flow to the desktop UI through the same `ws:*` events the Tauri commands emit,
//! so the agent and developer share one view of the socket.

use std::sync::Arc;

use serde_json::{json, Value};
use voleeo_core::{new_id, now_iso, WsDirection, WsMessage, WsMessageKind};
use voleeo_ws::{WsEvent, WsEventSink};

use super::{redact, ApiBackend};
use crate::{protocol::ToolResult, resolve};

impl ApiBackend {
    pub(super) fn ws_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let reveal = redact::reveal(args);
        match self.ws.list(&ws_id) {
            Ok(mut conns) => {
                if !reveal {
                    for c in conns.iter_mut() {
                        redact::mask_auth(&mut c.auth);
                    }
                }
                ToolResult::json(&conns)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) fn ws_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let url = require!(args, "url");
        let folder_id = args["folderId"].as_str().map(str::to_string);
        match self.ws.create(ws_id.clone(), folder_id, name, url) {
            Ok(conn) => {
                self.notify_connections(&ws_id);
                ToolResult::json(&conn)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    /// Sink for MCP-initiated sockets: push `ws:*` events to the UI via `notify`
    /// and persist each frame/event to the transcript ring buffer.
    fn ws_sink(&self, workspace_id: String, connection_id: String) -> WsEventSink {
        let notify = self.notify.clone();
        let transcripts = self.ws_transcripts.clone();
        Arc::new(move |ev: WsEvent| match ev {
            WsEvent::Status(status) => {
                notify(
                    "ws:status",
                    json!({ "connectionId": connection_id, "status": status }),
                );
            }
            WsEvent::Message(msg) => {
                notify(
                    "ws:message",
                    json!({ "connectionId": connection_id, "message": &msg }),
                );
                let (t, ws, c) = (
                    transcripts.clone(),
                    workspace_id.clone(),
                    connection_id.clone(),
                );
                tokio::task::spawn_blocking(move || {
                    let _ = t.append_message(&ws, &c, msg);
                });
            }
            WsEvent::Timeline(event) => {
                notify(
                    "ws:timeline",
                    json!({ "connectionId": connection_id, "event": &event }),
                );
                let (t, ws, c) = (
                    transcripts.clone(),
                    workspace_id.clone(),
                    connection_id.clone(),
                );
                tokio::task::spawn_blocking(move || {
                    let _ = t.append_event(&ws, &c, event);
                });
            }
        })
    }

    pub(super) async fn ws_connect_tool(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let conn_id = require!(args, "connectionId");
        let env_id = args["environmentId"].as_str().map(str::to_string);

        let conn = match self.ws.get(&ws_id, &conn_id) {
            Ok(c) => c,
            Err(e) => return ToolResult::error(e.to_string()),
        };

        // Resolve `{{ VAR }}` + inject auth via the shared WS resolver.
        let envs = self.environments.list(&ws_id).unwrap_or_default();
        let mut vars =
            resolve::load_env_vars_from(&envs, &ws_id, env_id.as_deref(), &self.app_data_dir);
        let folders = self.requests.list_folders(&ws_id).unwrap_or_default();
        let key = voleeo_crypto::load_key_from_file(&ws_id, &self.app_data_dir).ok();
        resolve::apply_folder_vars(&mut vars, conn.folder_id.as_deref(), &folders, key.as_ref());
        let (url, headers) = resolve::apply_to_connection(&conn, &vars);

        // Fresh history session for this connect (matches the Tauri path).
        let _ = self.ws_transcripts.start_session(&ws_id, &conn_id);
        let sink = self.ws_sink(ws_id.clone(), conn_id.clone());
        match self
            .ws_manager
            .connect(conn_id.clone(), url, headers, sink)
            .await
        {
            Ok(()) => ToolResult::json(&json!({ "connectionId": conn_id, "status": "open" })),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) fn ws_send(&self, args: &Value) -> ToolResult {
        let conn_id = require!(args, "connectionId");
        let data = require!(args, "data");
        let ws_id = require!(args, "workspaceId");
        let kind = match args["kind"].as_str() {
            Some("binary") => WsMessageKind::Binary,
            _ => WsMessageKind::Text,
        };

        if let Err(e) = self.ws_manager.send_message(&conn_id, kind, data.clone()) {
            return ToolResult::error(e.to_string());
        }
        let msg = WsMessage {
            id: new_id(),
            direction: WsDirection::Outgoing,
            kind,
            data: data.clone(),
            size: data.len() as u32,
            at: now_iso(),
        };
        (self.notify)(
            "ws:message",
            json!({ "connectionId": conn_id, "message": &msg }),
        );
        let _ = self
            .ws_transcripts
            .append_message(&ws_id, &conn_id, msg.clone());
        ToolResult::json(&msg)
    }

    pub(super) fn ws_read_messages(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let conn_id = require!(args, "connectionId");
        // Return the current (newest) session's transcript + events.
        let session = self.ws_transcripts.latest(&ws_id, &conn_id);
        ToolResult::json(&session)
    }

    pub(super) fn ws_disconnect(&self, args: &Value) -> ToolResult {
        let conn_id = require!(args, "connectionId");
        self.ws_manager.disconnect(&conn_id);
        (self.notify)(
            "ws:status",
            json!({ "connectionId": conn_id, "status": "closed" }),
        );
        ToolResult::json(&json!({ "connectionId": conn_id, "status": "closed" }))
    }
}
