//! gRPC MCP tools. The agent can list/create requests, introspect services via
//! reflection or `.proto` import, run unary calls, and drive streaming calls —
//! all with protobuf-JSON payloads (no form, unlike the desktop UI). Live frames
//! flow to the UI through the same `grpc:*` events the Tauri commands emit.

use std::sync::Arc;

use serde_json::{json, Value};
use voleeo_core::{
    new_id, now_iso, GrpcRequest, GrpcRpcKind, GrpcStreamMessage, VoleeoError, WsDirection,
};
use voleeo_grpc::{GrpcEvent, GrpcEventSink, ResolvedDescriptors, StreamSpec};
use voleeo_storage::GrpcUpdate;

use super::{redact, ApiBackend};
use crate::{protocol::ToolResult, resolve};

/// Read the `message` arg as a protobuf-JSON string (string passed through;
/// object/array re-serialized; null → stored payload via caller default).
fn message_arg(args: &Value) -> Option<String> {
    match &args["message"] {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

/// True when the call carries a `service`/`method`/`message` override — i.e. it
/// mutates the stored request, so the selection must be persisted and the UI told
/// to refresh.
fn touches_selection(args: &Value) -> bool {
    args["service"].as_str().is_some()
        || args["method"].as_str().is_some()
        || !matches!(args["message"], Value::Null)
}

impl ApiBackend {
    pub(super) async fn grpc_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let reveal = redact::reveal(args);
        let grpc = self.grpc.clone();
        match super::blocking(move || grpc.list(&ws_id)).await {
            Ok(mut items) => {
                if !reveal {
                    for it in items.iter_mut() {
                        redact::mask_auth(&mut it.auth);
                    }
                }
                ToolResult::json(&items)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn grpc_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let target = require!(args, "target");
        let folder_id = args["folderId"].as_str().map(str::to_string);
        let grpc = self.grpc.clone();
        let ws = ws_id.clone();
        match super::blocking(move || grpc.create(ws, folder_id, name, target)).await {
            Ok(req) => {
                self.notify_grpc(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    async fn grpc_resolve(
        &self,
        ws_id: &str,
        id: &str,
    ) -> Result<(GrpcRequest, Arc<ResolvedDescriptors>), VoleeoError> {
        let req = self.grpc.get(ws_id, id)?;
        let resolved = self
            .grpc_descriptors
            .get_or_build(id, &req.proto_source, &req.target, req.tls)
            .await?;
        Ok((req, resolved))
    }

    /// List services, or describe one method (with its input message schema) when
    /// `service`+`method` are given — the agent learns the JSON shape to send.
    pub(super) async fn grpc_describe(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let (_, resolved) = match self.grpc_resolve(&ws_id, &id).await {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        match (args["service"].as_str(), args["method"].as_str()) {
            (Some(svc), Some(method)) => resolved
                .services
                .iter()
                .find(|s| s.name == svc)
                .and_then(|s| s.methods.iter().find(|m| m.name == method))
                .map(ToolResult::json)
                .unwrap_or_else(|| ToolResult::error(format!("method {svc}/{method} not found"))),
            _ => ToolResult::json(&resolved.services),
        }
    }

    /// Build a request with arg overrides (service/method/message) applied and
    /// fully send-resolved, on the blocking pool — `prepare` reads YAML stores
    /// and the key file (CLAUDE.md #17).
    async fn prepare_blocking(
        &self,
        args: &Value,
        ws_id: &str,
        id: &str,
    ) -> Result<GrpcReady, VoleeoError> {
        let (grpc, environments, requests, workspaces, app_data_dir) = (
            self.grpc.clone(),
            self.environments.clone(),
            self.requests.clone(),
            self.workspaces.clone(),
            self.app_data_dir.clone(),
        );
        let (args, ws_id, id) = (args.clone(), ws_id.to_string(), id.to_string());
        tokio::task::spawn_blocking(move || {
            let mut req = grpc.get(&ws_id, &id)?;
            if let Some(s) = args["service"].as_str() {
                req.service = Some(s.to_string());
            }
            if let Some(m) = args["method"].as_str() {
                req.method = Some(m.to_string());
            }
            if let Some(msg) = message_arg(&args) {
                req.message = msg;
            }
            // Persist the agent's selection so the open desktop UI shows what was
            // called — the gRPC pane reads service/method/message from the stored
            // request. Best-effort (a persist hiccup must not fail the call) and
            // idempotent via save_if_changed. Done BEFORE resolve, which rewrites
            // auth into send-time headers we must not store; auth is written back
            // exactly as read, so encrypted workspaces are untouched.
            if touches_selection(&args) {
                let _ = grpc.update(
                    &ws_id,
                    &id,
                    GrpcUpdate {
                        target: req.target.clone(),
                        tls: req.tls,
                        proto_source: req.proto_source.clone(),
                        service: req.service.clone(),
                        method: req.method.clone(),
                        metadata: req.metadata.clone(),
                        message: req.message.clone(),
                        auth: req.auth.clone(),
                    },
                );
            }
            let (req, message, metadata) = resolve::resolve_grpc_for_send(
                req,
                args["environmentId"].as_str(),
                &environments,
                &requests,
                &workspaces,
                &app_data_dir,
            );
            Ok(GrpcReady {
                req,
                message,
                metadata,
            })
        })
        .await
        .map_err(|e| VoleeoError::Grpc(format!("prepare task: {e}")))?
    }

    pub(super) async fn grpc_call_tool(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let ready = match self.prepare_blocking(args, &ws_id, &id).await {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        // prepare_blocking persisted the selection; tell the UI to reload it.
        if touches_selection(args) {
            self.notify_grpc(&ws_id);
        }
        let resolved = match self
            .grpc_descriptors
            .get_or_build(
                &id,
                &ready.req.proto_source,
                &ready.req.target,
                ready.req.tls,
            )
            .await
        {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        match self
            .grpc_executor
            .call(&ready.req, &resolved, &ready.message, ready.metadata)
            .await
        {
            Ok(resp) => {
                let responses = self.grpc_responses.clone();
                let stored = resp.clone();
                tokio::task::spawn_blocking(move || {
                    let _ = responses.append(&ws_id, &id, stored, 20);
                });
                ToolResult::json(&resp)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    /// Sink for MCP-initiated streams: push `grpc:*` events to the UI via
    /// `notify` and persist each frame/event to the transcript.
    fn grpc_sink(&self, workspace_id: String, request_id: String) -> GrpcEventSink {
        let notify = self.notify.clone();
        let transcripts = self.grpc_transcripts.clone();
        Arc::new(move |ev: GrpcEvent| match ev {
            GrpcEvent::Status(status) => {
                notify(
                    "grpc:status",
                    json!({ "requestId": request_id, "status": status }),
                );
            }
            GrpcEvent::Message(msg) => {
                notify(
                    "grpc:message",
                    json!({ "requestId": request_id, "message": &msg }),
                );
                let (t, ws, r) = (
                    transcripts.clone(),
                    workspace_id.clone(),
                    request_id.clone(),
                );
                tokio::task::spawn_blocking(move || {
                    let _ = t.append_message(&ws, &r, msg);
                });
            }
            GrpcEvent::Timeline(event) => {
                notify(
                    "grpc:timeline",
                    json!({ "requestId": request_id, "event": &event }),
                );
                let (t, ws, r) = (
                    transcripts.clone(),
                    workspace_id.clone(),
                    request_id.clone(),
                );
                tokio::task::spawn_blocking(move || {
                    let _ = t.append_event(&ws, &r, event);
                });
            }
        })
    }

    pub(super) async fn grpc_stream_start_tool(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let ready = match self.prepare_blocking(args, &ws_id, &id).await {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        // prepare_blocking persisted the selection; tell the UI to reload it.
        if touches_selection(args) {
            self.notify_grpc(&ws_id);
        }
        let resolved = match self
            .grpc_descriptors
            .get_or_build(
                &id,
                &ready.req.proto_source,
                &ready.req.target,
                ready.req.tls,
            )
            .await
        {
            Ok(r) => r,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        let (Some(service), Some(method_name)) =
            (ready.req.service.clone(), ready.req.method.clone())
        else {
            return ToolResult::error("service and method are required");
        };
        let method = match resolved.method(&service, &method_name) {
            Ok(m) => m,
            Err(e) => return ToolResult::error(e.to_string()),
        };
        let kind = match (method.is_client_streaming(), method.is_server_streaming()) {
            (false, false) => GrpcRpcKind::Unary,
            (false, true) => GrpcRpcKind::ServerStreaming,
            (true, false) => GrpcRpcKind::ClientStreaming,
            (true, true) => GrpcRpcKind::Bidi,
        };
        let first = (!ready.message.trim().is_empty()).then_some(ready.message);
        // Awaited so the session exists before the stream's first events persist.
        let transcripts = self.grpc_transcripts.clone();
        let (ws, rid) = (ws_id.clone(), id.clone());
        let _ = tokio::task::spawn_blocking(move || transcripts.start_session(&ws, &rid)).await;
        let sink = self.grpc_sink(ws_id, id.clone());
        match self
            .grpc_manager
            .start_stream(
                StreamSpec {
                    id: id.clone(),
                    target: ready.req.target,
                    tls: ready.req.tls,
                    service,
                    kind,
                    metadata: ready.metadata,
                },
                &method,
                first,
                sink,
            )
            .await
        {
            Ok(()) => ToolResult::json(&json!({ "id": id, "status": "streaming" })),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn grpc_stream_send_tool(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let message = require!(args, "message");
        // send_message is in-memory (manager); fine on the runtime.
        if let Err(e) = self.grpc_manager.send_message(&id, &message) {
            return ToolResult::error(e.to_string());
        }
        let msg = GrpcStreamMessage {
            id: new_id(),
            direction: WsDirection::Outgoing,
            size: message.len() as u32,
            data: message,
            at: now_iso(),
        };
        (self.notify)("grpc:message", json!({ "requestId": id, "message": &msg }));
        // The transcript append is fs — offload it.
        let transcripts = self.grpc_transcripts.clone();
        let (ws, rid, persist) = (ws_id, id, msg.clone());
        let _ = super::blocking(move || transcripts.append_message(&ws, &rid, persist)).await;
        ToolResult::json(&msg)
    }

    pub(super) async fn grpc_stream_read(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        let transcripts = self.grpc_transcripts.clone();
        match super::blocking(move || Ok::<_, VoleeoError>(transcripts.latest(&ws_id, &id))).await {
            Ok(session) => ToolResult::json(&session),
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn grpc_stream_close(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        // Verify the request belongs to this workspace before acting.
        let grpc = self.grpc.clone();
        let (ws, gid) = (ws_id, id.clone());
        if let Err(e) = super::blocking(move || grpc.get(&ws, &gid).map(|_| ())).await {
            return ToolResult::error(e.to_string());
        }
        self.grpc_manager.cancel(&id);
        (self.notify)("grpc:status", json!({ "requestId": id, "status": "done" }));
        ToolResult::json(&json!({ "id": id, "status": "done" }))
    }

    pub(super) async fn grpc_delete(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let id = require!(args, "id");
        // Cancel any in-flight stream + unary call, drop cached descriptors,
        // then clear history and delete the saved request (mirrors the desktop).
        self.grpc_manager.cancel(&id);
        self.grpc_executor.cancel(&id);
        self.grpc_descriptors.evict(&id);
        let grpc = self.grpc.clone();
        let responses = self.grpc_responses.clone();
        let transcripts = self.grpc_transcripts.clone();
        let (ws, gid) = (ws_id.clone(), id.clone());
        let result = super::blocking(move || -> Result<(), VoleeoError> {
            let _ = responses.clear(&ws, &gid);
            let _ = transcripts.clear(&ws, &gid);
            grpc.delete(&ws, &gid)
        })
        .await;
        match result {
            Ok(()) => {
                self.notify_grpc(&ws_id);
                ToolResult::json(&json!({ "deleted": id }))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}

/// A request ready to execute: arg overrides applied, vars/auth resolved.
struct GrpcReady {
    req: GrpcRequest,
    message: String,
    metadata: Vec<(String, String)>,
}
