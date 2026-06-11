//! Unary gRPC executor — the gRPC counterpart of `HttpExecutor`. Builds a fresh
//! `Channel` per call, encodes the protobuf-JSON request via `DynamicCodec`,
//! and races the call against a per-id cancel signal (CLAUDE.md cancellation
//! pattern: `oneshot` + `tokio::select!`).

use crate::codec::DynamicCodec;
use crate::convert::{json_to_message, message_to_json};
use crate::descriptors::ResolvedDescriptors;
use http::uri::PathAndQuery;
use prost_reflect::MethodDescriptor;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tonic::metadata::{KeyAndValueRef, MetadataKey, MetadataMap, MetadataValue};
use tonic::Request;
use voleeo_core::{
    GrpcFailure, GrpcRequest, GrpcResponse, HttpResponseHeader, TimelineEvent, VoleeoError,
};

#[derive(Clone, Default)]
pub struct GrpcExecutor {
    /// Cancel handles by request id, raced against the call in `select!`.
    in_flight: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

impl GrpcExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Abort an in-flight unary call (no-op if none); the waiting `call` returns
    /// `VoleeoError::Cancelled`.
    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut map) = self.in_flight.lock() {
            if let Some(tx) = map.remove(request_id) {
                let _ = tx.send(());
            }
        }
    }

    /// Execute a unary RPC. `json` is the protobuf-JSON request payload;
    /// `metadata` is sent as gRPC metadata (incl. auth, resolved by the caller).
    pub async fn call(
        &self,
        request: &GrpcRequest,
        descriptors: &ResolvedDescriptors,
        json: &str,
        metadata: Vec<(String, String)>,
    ) -> Result<GrpcResponse, VoleeoError> {
        let service = request
            .service
            .as_deref()
            .ok_or_else(|| VoleeoError::InvalidConfig("no service selected".into()))?;
        let method_name = request
            .method
            .as_deref()
            .ok_or_else(|| VoleeoError::InvalidConfig("no method selected".into()))?;
        let method = descriptors.method(service, method_name)?;

        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let request_id = request.id.clone();
        if let Ok(mut map) = self.in_flight.lock() {
            if let Some(prev) = map.insert(request_id.clone(), cancel_tx) {
                let _ = prev.send(());
            }
        }

        let result = tokio::select! {
            biased;
            _ = cancel_rx => Err(VoleeoError::Cancelled),
            r = call_inner(request, service, &method, json, metadata) => r,
        };

        if let Ok(mut map) = self.in_flight.lock() {
            map.remove(&request_id);
        }
        result
    }
}

fn timeline(started: Instant, kind: &str, text: impl Into<String>) -> TimelineEvent {
    TimelineEvent {
        at_ms: started.elapsed().as_secs_f64() * 1000.0,
        kind: kind.to_string(),
        text: text.into(),
    }
}

async fn call_inner(
    request: &GrpcRequest,
    service: &str,
    method: &MethodDescriptor,
    json: &str,
    metadata: Vec<(String, String)>,
) -> Result<GrpcResponse, VoleeoError> {
    let started = Instant::now();
    let mut events = vec![timeline(
        started,
        "config",
        format!("{} → {}", request.target, method.full_name()),
    )];

    let body = json_to_message(method.input(), json)?;
    let channel = crate::channel::build(&request.target, request.tls).await?;
    events.push(timeline(started, "send", "request sent"));

    let path = PathAndQuery::from_str(&format!("/{}/{}", service, method.name()))
        .map_err(|e| VoleeoError::Grpc(format!("invalid method path: {e}")))?;
    let mut req = Request::new(body);
    apply_metadata(req.metadata_mut(), &metadata)?;

    let codec = DynamicCodec::new(method.output());
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| VoleeoError::Grpc(format!("service not ready: {e}")))?;

    // Invoked as server-streaming (same wire shape as unary, one message) so
    // trailers are readable — tonic's `unary` swallows them.
    let response = client
        .server_streaming(req, path, codec)
        .await
        .map_err(|status| grpc_failure(&events, started, &status))?;
    let (head, mut body, _) = response.into_parts();
    let response_metadata = headers_from_map(&head, started);

    let message = body
        .message()
        .await
        .map_err(|status| grpc_failure(&events, started, &status))?
        .ok_or_else(|| VoleeoError::Grpc("server closed the call without a response".into()))?;
    events.push(timeline(started, "recv", "response received"));
    let message = message_to_json(&message)?;

    let trailers = body
        .trailers()
        .await
        .map_err(|status| grpc_failure(&events, started, &status))?
        .map(|md| headers_from_map(&md, started))
        .unwrap_or_default();
    events.push(timeline(started, "done", "completed"));

    Ok(GrpcResponse {
        request_id: request.id.clone(),
        status_code: 0,
        status_message: "OK".into(),
        message,
        metadata: response_metadata,
        trailers,
        total_ms: started.elapsed().as_secs_f64() * 1000.0,
        events,
        response_id: String::new(),
    })
}

fn grpc_failure(events: &[TimelineEvent], started: Instant, status: &tonic::Status) -> VoleeoError {
    let mut events = events.to_vec();
    events.push(timeline(started, "error", status.message().to_string()));
    VoleeoError::GrpcFailed(GrpcFailure {
        message: format!("{} ({:?})", status.message(), status.code()),
        events,
    })
}

/// Append caller-supplied metadata (lower-cased keys); gRPC metadata is
/// multi-valued, so duplicate keys all survive. Binary (`-bin`) values are out
/// of scope for the form path and rejected as invalid keys upstream.
pub(crate) fn apply_metadata(
    map: &mut MetadataMap,
    metadata: &[(String, String)],
) -> Result<(), VoleeoError> {
    for (k, v) in metadata {
        let key = MetadataKey::from_str(&k.to_ascii_lowercase())
            .map_err(|_| VoleeoError::InvalidConfig(format!("invalid metadata key: {k}")))?;
        let val = MetadataValue::from_str(v)
            .map_err(|_| VoleeoError::InvalidConfig(format!("invalid metadata value for {k}")))?;
        map.append(key, val);
    }
    Ok(())
}

fn headers_from_map(md: &MetadataMap, started: Instant) -> Vec<HttpResponseHeader> {
    md.iter()
        .filter_map(|kv| match kv {
            KeyAndValueRef::Ascii(k, v) => Some(HttpResponseHeader {
                name: k.as_str().to_string(),
                value: v.to_str().unwrap_or("").to_string(),
                at_ms: started.elapsed().as_secs_f64() * 1000.0,
            }),
            KeyAndValueRef::Binary(_, _) => None,
        })
        .collect()
}
