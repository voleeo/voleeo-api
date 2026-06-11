//! Live streaming gRPC calls — the gRPC counterpart of `WsManager`. Server-,
//! client-, and bidirectional-streaming calls are tracked by request id; the
//! outbound channel (client/bidi) feeds the request stream and half-close =
//! dropping the sender. Locks are never held across `.await` (CLAUDE.md #19).

mod streaming;

use crate::codec::DynamicCodec;
use crate::convert::{json_to_message, message_to_json};
use http::uri::PathAndQuery;
use prost_reflect::{DynamicMessage, MessageDescriptor, MethodDescriptor};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use voleeo_core::{
    new_id, now_iso, GrpcRpcKind, GrpcStreamMessage, TimelineEvent, VoleeoError, WsDirection,
};

/// Events the manager pushes to its sink (the Tauri command layer emits these
/// as `grpc:*` events and persists them).
pub enum GrpcEvent {
    /// "connecting" | "streaming" | "done" | "error".
    Status(&'static str),
    Message(GrpcStreamMessage),
    Timeline(TimelineEvent),
}

pub type GrpcEventSink = Arc<dyn Fn(GrpcEvent) + Send + Sync>;

struct LiveCall {
    /// `Some` for client-streaming/bidi (feeds the request stream); `None` for
    /// server-streaming. Dropping it (or setting to `None`) half-closes.
    outbound: Option<mpsc::UnboundedSender<DynamicMessage>>,
    /// Input message descriptor, to decode `send_message` JSON payloads.
    input_desc: MessageDescriptor,
    reader: JoinHandle<()>,
}

/// Connection parameters for one streaming call (the descriptor is passed
/// separately so the manager stays free of the descriptor cache).
pub struct StreamSpec {
    pub id: String,
    pub target: String,
    pub tls: bool,
    pub service: String,
    pub kind: GrpcRpcKind,
    pub metadata: Vec<(String, String)>,
}

#[derive(Clone, Default)]
pub struct GrpcManager {
    calls: Arc<Mutex<HashMap<String, LiveCall>>>,
}

/// A server→client message row.
pub(super) fn incoming(msg: &DynamicMessage) -> GrpcStreamMessage {
    let data = message_to_json(msg).unwrap_or_default();
    GrpcStreamMessage {
        id: new_id(),
        direction: WsDirection::Incoming,
        size: data.len() as u32,
        data,
        at: now_iso(),
    }
}

impl GrpcManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.calls
            .lock()
            .map(|m| m.contains_key(id))
            .unwrap_or(false)
    }

    /// Open a streaming call. `first_message` (protobuf-JSON) is the single
    /// request for server-streaming, or an optional first frame for client/bidi.
    pub async fn start_stream(
        &self,
        spec: StreamSpec,
        method: &MethodDescriptor,
        first_message: Option<String>,
        sink: GrpcEventSink,
    ) -> Result<(), VoleeoError> {
        sink(GrpcEvent::Status("connecting"));
        let started = Instant::now();
        let input_desc = method.input();

        let channel = match crate::channel::build(&spec.target, spec.tls).await {
            Ok(c) => c,
            Err(e) => {
                sink(GrpcEvent::Timeline(timeline(
                    started,
                    "error",
                    e.to_string(),
                )));
                sink(GrpcEvent::Status("error"));
                return Err(e);
            }
        };
        let path = PathAndQuery::from_str(&format!("/{}/{}", spec.service, method.name()))
            .map_err(|e| VoleeoError::Grpc(format!("invalid method path: {e}")))?;

        // Server-streaming requires exactly one request; default to an empty
        // message when the caller sent none.
        let first = match first_message {
            Some(j) if !j.trim().is_empty() => Some(json_to_message(input_desc.clone(), &j)?),
            _ if matches!(spec.kind, GrpcRpcKind::ServerStreaming) => {
                Some(DynamicMessage::new(input_desc.clone()))
            }
            _ => None,
        };

        let codec = DynamicCodec::new(method.output());
        let mut client = tonic::client::Grpc::new(channel);
        client
            .ready()
            .await
            .map_err(|e| VoleeoError::Grpc(format!("service not ready: {e}")))?;

        let (outbound, reader) = streaming::spawn(
            spec.kind,
            client,
            path,
            codec,
            spec.metadata,
            first,
            sink.clone(),
            self.calls.clone(),
            spec.id.clone(),
            started,
        )?;

        if let Ok(mut map) = self.calls.lock() {
            if let Some(prev) = map.insert(
                spec.id,
                LiveCall {
                    outbound,
                    input_desc,
                    reader,
                },
            ) {
                prev.reader.abort();
            }
        }
        sink(GrpcEvent::Status("streaming"));
        Ok(())
    }

    /// Enqueue a client→server message (client-streaming/bidi only). `json` is a
    /// protobuf-JSON payload, decoded against the call's input descriptor.
    pub fn send_message(&self, id: &str, json: &str) -> Result<(), VoleeoError> {
        let (tx, input_desc) = {
            let map = self
                .calls
                .lock()
                .map_err(|_| VoleeoError::Grpc("call registry poisoned".into()))?;
            let call = map
                .get(id)
                .ok_or_else(|| VoleeoError::Grpc("stream not active".into()))?;
            let tx = call.outbound.clone().ok_or_else(|| {
                VoleeoError::Grpc("stream does not accept client messages".into())
            })?;
            (tx, call.input_desc.clone())
        };
        let msg = json_to_message(input_desc, json)?;
        tx.send(msg)
            .map_err(|_| VoleeoError::Grpc("stream closed".into()))
    }

    /// Half-close the client side (drop the request stream); the server may
    /// still send responses (bidi) or its final message (client-streaming).
    pub fn close_send(&self, id: &str) {
        if let Ok(mut map) = self.calls.lock() {
            if let Some(call) = map.get_mut(id) {
                call.outbound = None;
            }
        }
    }

    /// Abort the call entirely.
    pub fn cancel(&self, id: &str) {
        if let Ok(mut map) = self.calls.lock() {
            if let Some(call) = map.remove(id) {
                call.reader.abort();
            }
        }
    }
}

fn timeline(started: Instant, kind: &str, text: impl Into<String>) -> TimelineEvent {
    TimelineEvent {
        at_ms: started.elapsed().as_secs_f64() * 1000.0,
        kind: kind.to_string(),
        text: text.into(),
    }
}
