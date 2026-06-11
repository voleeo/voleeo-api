//! Per-kind streaming drivers. Each spawns a task that runs the gRPC call and
//! pumps responses into the sink; the request stream (client/bidi) is fed by an
//! unbounded channel whose sender is returned for `send_message`/half-close.

use super::{incoming, timeline, GrpcEvent, GrpcEventSink, LiveCall};
use crate::codec::DynamicCodec;
use crate::executor::apply_metadata;
use http::uri::PathAndQuery;
use prost_reflect::DynamicMessage;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tonic::client::Grpc;
use tonic::transport::Channel;
use tonic::{Request, Status, Streaming};
use voleeo_core::{GrpcRpcKind, VoleeoError};

type Sender = mpsc::UnboundedSender<DynamicMessage>;
type Calls = Arc<Mutex<HashMap<String, LiveCall>>>;

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn(
    kind: GrpcRpcKind,
    mut client: Grpc<Channel>,
    path: PathAndQuery,
    codec: DynamicCodec,
    metadata: Vec<(String, String)>,
    first: Option<DynamicMessage>,
    sink: GrpcEventSink,
    calls: Calls,
    id: String,
    started: Instant,
) -> Result<(Option<Sender>, JoinHandle<()>), VoleeoError> {
    match kind {
        GrpcRpcKind::ServerStreaming => {
            let msg = first
                .ok_or_else(|| VoleeoError::Grpc("server-streaming needs a request".into()))?;
            let mut req = Request::new(msg);
            apply_metadata(req.metadata_mut(), &metadata)?;
            let handle = tokio::spawn(async move {
                match client.server_streaming(req, path, codec).await {
                    Ok(resp) => drain(resp.into_inner(), &sink, started).await,
                    Err(status) => emit_error(&sink, started, status),
                }
                forget(&calls, &id);
            });
            Ok((None, handle))
        }
        GrpcRpcKind::ClientStreaming => {
            let (tx, rx) = mpsc::unbounded_channel();
            if let Some(f) = first {
                let _ = tx.send(f);
            }
            let mut req = Request::new(UnboundedReceiverStream::new(rx));
            apply_metadata(req.metadata_mut(), &metadata)?;
            let handle = tokio::spawn(async move {
                match client.client_streaming(req, path, codec).await {
                    Ok(resp) => {
                        sink(GrpcEvent::Message(incoming(resp.get_ref())));
                        sink(GrpcEvent::Status("done"));
                    }
                    Err(status) => emit_error(&sink, started, status),
                }
                forget(&calls, &id);
            });
            Ok((Some(tx), handle))
        }
        GrpcRpcKind::Bidi => {
            let (tx, rx) = mpsc::unbounded_channel();
            if let Some(f) = first {
                let _ = tx.send(f);
            }
            let mut req = Request::new(UnboundedReceiverStream::new(rx));
            apply_metadata(req.metadata_mut(), &metadata)?;
            let handle = tokio::spawn(async move {
                match client.streaming(req, path, codec).await {
                    Ok(resp) => drain(resp.into_inner(), &sink, started).await,
                    Err(status) => emit_error(&sink, started, status),
                }
                forget(&calls, &id);
            });
            Ok((Some(tx), handle))
        }
        GrpcRpcKind::Unary => Err(VoleeoError::Grpc("unary is not a streaming call".into())),
    }
}

/// Pump a server response stream into the sink until it ends or errors.
async fn drain(mut stream: Streaming<DynamicMessage>, sink: &GrpcEventSink, started: Instant) {
    loop {
        match stream.message().await {
            Ok(Some(msg)) => sink(GrpcEvent::Message(incoming(&msg))),
            Ok(None) => {
                sink(GrpcEvent::Status("done"));
                return;
            }
            Err(status) => {
                emit_error(sink, started, status);
                return;
            }
        }
    }
}

fn emit_error(sink: &GrpcEventSink, started: Instant, status: Status) {
    sink(GrpcEvent::Timeline(timeline(
        started,
        "error",
        format!("{} ({:?})", status.message(), status.code()),
    )));
    sink(GrpcEvent::Status("error"));
}

fn forget(calls: &Calls, id: &str) {
    if let Ok(mut map) = calls.lock() {
        map.remove(id);
    }
}
