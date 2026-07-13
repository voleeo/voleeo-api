//! Saved-snapshot MCP tools: save / list / get / replay. No delete or rename —
//! destructive/cosmetic ops stay human-only. Schemas in `tools::snapshot`.

use super::{redact, ApiBackend};
use crate::protocol::ToolResult;
use serde_json::Value;

impl ApiBackend {
    pub(super) async fn snapshot_save(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let resp_id = require!(args, "responseId");
        let name = args["name"].as_str().map(str::to_string);
        let snapshots = self.snapshots.clone();
        let responses = self.responses.clone();
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        let result = super::blocking(move || {
            snapshots.promote(&responses, &requests, &ws, &req_id, &resp_id, name)
        })
        .await;
        match result {
            Ok(snapshot) => {
                self.notify_snapshots(&ws_id);
                ToolResult::json(&snapshot_summary(&snapshot))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn snapshot_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let snapshots = self.snapshots.clone();
        super::run_blocking(move || match snapshots.list(&ws_id, &req_id) {
            Ok(list) => {
                let summaries: Vec<Value> = list.iter().map(snapshot_summary).collect();
                ToolResult::json(&summaries)
            }
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) async fn snapshot_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let snapshot_id = require!(args, "snapshotId");
        let reveal = redact::reveal(args);
        let snapshots = self.snapshots.clone();
        let app_data_dir = self.app_data_dir.clone();
        super::run_blocking(move || {
            let snapshot = match snapshots.get(&ws_id, &snapshot_id) {
                Ok(p) => p,
                Err(e) => return ToolResult::error(e.to_string()),
            };
            let mut snapshot = snapshots.decrypt_for_display(&ws_id, snapshot);
            if reveal {
                // Auth config fields stay ciphertext after decrypt_for_display;
                // reveal opts into plaintext (keyfile only, headless-safe).
                if let Ok(key) = voleeo_crypto::load_key_from_file(&ws_id, &app_data_dir) {
                    for (secret, _) in snapshot.request.auth.secret_fields_mut() {
                        if voleeo_crypto::is_encrypted(secret) {
                            if let Ok(plain) = voleeo_crypto::decrypt(secret, &key) {
                                *secret = plain;
                            }
                        }
                    }
                }
            } else {
                redact::mask_auth(&mut snapshot.request.auth);
            }
            ToolResult::json(&snapshot)
        })
        .await
    }

    pub(super) async fn snapshot_replay(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let snapshot_id = require!(args, "snapshotId");
        let snapshots = self.snapshots.clone();
        let ws = ws_id.clone();
        let pid = snapshot_id.clone();
        let prepared = super::blocking(move || {
            let snapshot = snapshots.get(&ws, &pid)?;
            let (request, cookies) = snapshots.prepare_for_replay(&ws, &snapshot)?;
            Ok((snapshot, request, cookies))
        })
        .await;
        let (snapshot, request, cookies) = match prepared {
            Ok(p) => p,
            Err(e) => return ToolResult::error(e.to_string()),
        };

        // WorkspaceStore::get reads workspace.yaml from disk — offload it (rule 17).
        let workspaces = self.workspaces.clone();
        let ws_for_dns = ws_id.clone();
        let dns_overrides = super::blocking(move || {
            Ok(workspaces
                .get(&ws_for_dns)
                .map(|w| w.dns_overrides)
                .unwrap_or_default())
        })
        .await
        .unwrap_or_default();
        // Guarded like request.send: the target URL is data, not vetted by a human.
        let response = match self
            .executor
            .send_guarded(&request, cookies, dns_overrides)
            .await
        {
            Ok(r) => r,
            Err(e) => return ToolResult::error(redact::redact_error(&e.to_string())),
        };
        let status_matches = response.status == snapshot.response.status;

        // Single machine-local "latest" slot per snapshot (limit=1), under a
        // pseudo request id that can't collide with real request history.
        let responses = self.responses.clone();
        let pseudo_id = format!("snapshot_{snapshot_id}");
        let resp_clone = response.clone();
        let req_clone = request.clone();
        let stored =
            super::blocking(move || responses.append(&ws_id, &pseudo_id, resp_clone, req_clone, 1))
                .await;
        let response = match stored {
            Ok(s) => s.response,
            Err(e) => {
                eprintln!("[mcp] failed to store snapshot replay result: {e}");
                response
            }
        };

        ToolResult::json(&serde_json::json!({
            "statusMatches": status_matches,
            "saved": { "status": snapshot.response.status },
            "response": response,
        }))
    }
}

/// Lightweight listing shape — full snapshots carry whole bodies; agents page in
/// detail via `snapshot.get`.
fn snapshot_summary(snapshot: &voleeo_core::Snapshot) -> Value {
    serde_json::json!({
        "id": snapshot.id,
        "requestId": snapshot.request_id,
        "name": snapshot.name,
        "createdAt": snapshot.created_at,
        "encrypted": snapshot.encrypted,
        "method": snapshot.request.method,
        "url": redact::redact_url(&snapshot.request.url),
        "status": snapshot.response.status,
    })
}
