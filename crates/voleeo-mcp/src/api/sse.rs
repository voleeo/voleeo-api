use super::ApiBackend;
use crate::protocol::ToolResult;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use voleeo_core::SseFrame;
use voleeo_storage::{ResponseStore, StoredHttpResponse};

/// Resolve the target stored response — a specific `responseId`, or the latest.
fn load(
    responses: &ResponseStore,
    ws: &str,
    req: &str,
    resp_id: Option<&str>,
) -> Result<StoredHttpResponse, String> {
    let found = match resp_id {
        Some(id) => responses.get(ws, req, id).map_err(|e| e.to_string())?,
        None => responses.latest(ws, req).map_err(|e| e.to_string())?,
    };
    found.ok_or_else(|| match resp_id {
        Some(id) => format!("Response {id} not found"),
        None => "No stored responses for this request".to_string(),
    })
}

/// `None` matches every frame; otherwise compare against the frame's event
/// (default `message` when the frame omits one).
fn matches_event(frame: &SseFrame, event: Option<&str>) -> bool {
    match event {
        None => true,
        Some(e) => frame.event.as_deref().unwrap_or("message") == e,
    }
}

/// Frames are seq-stamped 0.., and the 2000-cap drops the OLDEST, so the last
/// kept frame's seq + 1 is the true count of frames the server sent.
fn total_received(frames: &[SseFrame]) -> u32 {
    frames.last().map_or(0, |f| f.seq + 1)
}

impl ApiBackend {
    /// Last N parsed SSE frames of a stored response (latest unless given).
    pub(super) async fn sse_tail(&self, args: &Value) -> ToolResult {
        let ws = require!(args, "workspaceId");
        let req = require!(args, "requestId");
        let resp_id = args["responseId"].as_str().map(str::to_string);
        let event = args["event"].as_str().map(str::to_string);
        let limit = args["limit"].as_u64().unwrap_or(50).max(1) as usize;
        let responses = self.responses.clone();
        super::run_blocking(move || {
            let stored = match load(&responses, &ws, &req, resp_id.as_deref()) {
                Ok(s) => s,
                Err(e) => return ToolResult::error(e),
            };
            let frames = &stored.response.sse_frames;
            let matched: Vec<&SseFrame> = frames
                .iter()
                .filter(|f| matches_event(f, event.as_deref()))
                .collect();
            let tail = &matched[matched.len().saturating_sub(limit)..];
            ToolResult::json(&json!({
                "responseId": stored.id,
                "totalReceived": total_received(frames),
                "matched": matched.len(),
                "returned": tail.len(),
                "frames": tail,
            }))
        })
        .await
    }

    /// Counts/bytes/duration overview of a stored SSE response — cheap to read
    /// before deciding which frames to pull.
    pub(super) async fn sse_summary(&self, args: &Value) -> ToolResult {
        let ws = require!(args, "workspaceId");
        let req = require!(args, "requestId");
        let resp_id = args["responseId"].as_str().map(str::to_string);
        let responses = self.responses.clone();
        super::run_blocking(move || {
            let stored = match load(&responses, &ws, &req, resp_id.as_deref()) {
                Ok(s) => s,
                Err(e) => return ToolResult::error(e),
            };
            let frames = &stored.response.sse_frames;
            let mut events: BTreeMap<String, usize> = BTreeMap::new();
            let mut byte_total = 0usize;
            for f in frames {
                *events
                    .entry(f.event.clone().unwrap_or_else(|| "message".into()))
                    .or_default() += 1;
                byte_total += f.data.len();
            }
            ToolResult::json(&json!({
                "responseId": stored.id,
                "status": stored.response.status,
                "stored": frames.len(),
                "totalReceived": total_received(frames),
                "byteTotal": byte_total,
                "durationMs": stored.response.timing.total_ms,
                "firstSeq": frames.first().map(|f| f.seq),
                "lastSeq": frames.last().map(|f| f.seq),
                "events": events,
            }))
        })
        .await
    }

    /// Reassemble frame data into one string — e.g. concatenate an LLM token
    /// stream's `delta` fields back into the full completion.
    pub(super) async fn sse_assemble(&self, args: &Value) -> ToolResult {
        let ws = require!(args, "workspaceId");
        let req = require!(args, "requestId");
        let resp_id = args["responseId"].as_str().map(str::to_string);
        let event = args["event"].as_str().map(str::to_string);
        let field = args["field"].as_str().map(str::to_string);
        let responses = self.responses.clone();
        super::run_blocking(move || {
            let stored = match load(&responses, &ws, &req, resp_id.as_deref()) {
                Ok(s) => s,
                Err(e) => return ToolResult::error(e),
            };
            let mut out = String::new();
            let mut used = 0usize;
            for f in &stored.response.sse_frames {
                if !matches_event(f, event.as_deref()) {
                    continue;
                }
                match &field {
                    // Pull one JSON string field per frame (token deltas) + concat.
                    Some(key) => {
                        if let Some(s) = serde_json::from_str::<Value>(&f.data)
                            .ok()
                            .and_then(|v| v.get(key).and_then(|x| x.as_str().map(String::from)))
                        {
                            out.push_str(&s);
                            used += 1;
                        }
                    }
                    // No field: join raw data, one frame per line.
                    None => {
                        if used > 0 {
                            out.push('\n');
                        }
                        out.push_str(&f.data);
                        used += 1;
                    }
                }
            }
            ToolResult::json(&json!({
                "responseId": stored.id,
                "stored": stored.response.sse_frames.len(),
                "used": used,
                "assembled": out,
            }))
        })
        .await
    }
}
