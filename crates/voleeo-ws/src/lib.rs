//! Live WebSocket connections — Tauri-free counterpart to `HttpExecutor`.
//! Locks across `.await` are forbidden (CLAUDE.md #19): `send_message` clones
//! the sender before awaiting; the read loop touches `conns` only at teardown.

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::ClientRequestBuilder;
use tokio_tungstenite::tungstenite::http::Uri;
use tokio_tungstenite::tungstenite::Message;
use voleeo_core::{
    new_id, now_iso, TimelineEvent, VoleeoError, WsDirection, WsMessage, WsMessageKind,
};

pub enum WsEvent {
    Status(&'static str),
    Message(WsMessage),
    Timeline(TimelineEvent),
}

pub type WsEventSink = Arc<dyn Fn(WsEvent) + Send + Sync>;

/// Bounded so `send_message` can't buffer unboundedly when the peer stalls.
const OUTBOUND_CAP: usize = 1024;

struct LiveConn {
    outbound: mpsc::Sender<Message>,
    // `None` only during the insert-before-spawn window in `connect`; set to the
    // reader handle immediately after so teardown can never resurrect a dead entry.
    reader: Option<JoinHandle<()>>,
}

#[derive(Clone, Default)]
pub struct WsManager {
    conns: Arc<Mutex<HashMap<String, LiveConn>>>,
}

fn timeline(started: Instant, kind: &str, text: impl Into<String>) -> TimelineEvent {
    TimelineEvent {
        at_ms: started.elapsed().as_secs_f64() * 1000.0,
        kind: kind.to_string(),
        text: text.into(),
    }
}

fn incoming(kind: WsMessageKind, data: String, size: u32) -> WsMessage {
    WsMessage {
        id: new_id(),
        direction: WsDirection::Incoming,
        kind,
        data,
        size,
        at: now_iso(),
    }
}

impl WsManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_connected(&self, conn_id: &str) -> bool {
        self.conns
            .lock()
            .map(|m| m.contains_key(conn_id))
            .unwrap_or(false)
    }

    pub async fn connect(
        &self,
        conn_id: String,
        url: String,
        headers: Vec<(String, String)>,
        sink: WsEventSink,
    ) -> Result<(), VoleeoError> {
        sink(WsEvent::Status("connecting"));
        let started = Instant::now();

        let uri: Uri = url
            .parse()
            .map_err(|e| VoleeoError::WebSocket(format!("invalid URL: {e}")))?;
        let mut builder = ClientRequestBuilder::new(uri);
        for (k, v) in headers {
            builder = builder.with_header(k, v);
        }

        let (stream, response) = match tokio_tungstenite::connect_async(builder).await {
            Ok(ok) => ok,
            Err(e) => {
                let msg = e.to_string();
                sink(WsEvent::Timeline(timeline(started, "error", msg.clone())));
                sink(WsEvent::Status("error"));
                return Err(VoleeoError::WebSocket(msg));
            }
        };

        sink(WsEvent::Timeline(timeline(
            started,
            "handshake",
            "WebSocket handshake completed",
        )));
        if let Some(proto) = response
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|v| v.to_str().ok())
        {
            sink(WsEvent::Timeline(timeline(
                started,
                "info",
                format!("Negotiated subprotocol: {proto}"),
            )));
        }
        sink(WsEvent::Timeline(timeline(
            started,
            "open",
            "Connection open",
        )));
        sink(WsEvent::Status("open"));

        let (mut write, mut read) = stream.split();
        let (tx, mut rx) = mpsc::channel::<Message>(OUTBOUND_CAP);

        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(msg).await.is_err() {
                    return;
                }
            }
            // Sender dropped (disconnect) → close cleanly.
            let _ = write.send(Message::Close(None)).await;
            let _ = write.close().await;
        });

        // Insert BEFORE spawning the reader so a connection that closes immediately
        // can't run its teardown-remove before the entry exists (which would
        // resurrect a dead entry that leaks forever).
        if let Ok(mut map) = self.conns.lock() {
            if let Some(prev) = map.insert(
                conn_id.clone(),
                LiveConn {
                    outbound: tx,
                    reader: None,
                },
            ) {
                if let Some(h) = prev.reader {
                    h.abort();
                }
            }
        }

        let conns = self.conns.clone();
        let conn_id_read = conn_id.clone();
        let reader = tokio::spawn(async move {
            loop {
                match read.next().await {
                    Some(Ok(Message::Text(t))) => {
                        let size = t.len() as u32;
                        sink(WsEvent::Message(incoming(
                            WsMessageKind::Text,
                            t.to_string(),
                            size,
                        )));
                    }
                    Some(Ok(Message::Binary(b))) => {
                        let size = b.len() as u32;
                        let data = base64::engine::general_purpose::STANDARD.encode(&b);
                        sink(WsEvent::Message(incoming(
                            WsMessageKind::Binary,
                            data,
                            size,
                        )));
                    }
                    Some(Ok(Message::Ping(_))) => {
                        sink(WsEvent::Timeline(timeline(started, "ping", "← ping")))
                    }
                    Some(Ok(Message::Pong(_))) => {
                        sink(WsEvent::Timeline(timeline(started, "pong", "← pong")))
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let text = frame
                            .map(|f| format!("Closed: {} {}", u16::from(f.code), f.reason))
                            .unwrap_or_else(|| "Connection closed".to_string());
                        sink(WsEvent::Timeline(timeline(started, "close", text)));
                        sink(WsEvent::Status("closed"));
                        break;
                    }
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(e)) => {
                        sink(WsEvent::Timeline(timeline(started, "error", e.to_string())));
                        sink(WsEvent::Status("error"));
                        break;
                    }
                    None => {
                        sink(WsEvent::Timeline(timeline(
                            started,
                            "close",
                            "Connection closed",
                        )));
                        sink(WsEvent::Status("closed"));
                        break;
                    }
                }
            }
            if let Ok(mut map) = conns.lock() {
                map.remove(&conn_id_read);
            }
        });

        // Store the handle in the already-inserted entry. If teardown already
        // removed it (immediate close), the entry is gone — abort the now-orphan
        // reader (which has finished anyway) and leave the map clean.
        if let Ok(mut map) = self.conns.lock() {
            match map.get_mut(&conn_id) {
                Some(conn) => conn.reader = Some(reader),
                None => reader.abort(),
            }
        }
        Ok(())
    }

    pub fn send_message(
        &self,
        conn_id: &str,
        kind: WsMessageKind,
        data: String,
    ) -> Result<(), VoleeoError> {
        let tx = {
            let map = self
                .conns
                .lock()
                .map_err(|_| VoleeoError::WebSocket("connection registry poisoned".into()))?;
            map.get(conn_id).map(|c| c.outbound.clone())
        }
        .ok_or(VoleeoError::WebSocketClosed)?;

        let msg = match kind {
            WsMessageKind::Text => Message::Text(data.into()),
            WsMessageKind::Binary => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(data.as_bytes())
                    .map_err(|e| VoleeoError::WebSocket(format!("invalid base64: {e}")))?;
                Message::Binary(bytes.into())
            }
        };
        tx.try_send(msg).map_err(|e| match e {
            mpsc::error::TrySendError::Full(_) => {
                VoleeoError::WebSocket("send buffer full — peer is not draining messages".into())
            }
            mpsc::error::TrySendError::Closed(_) => VoleeoError::WebSocketClosed,
        })
    }

    pub fn disconnect(&self, conn_id: &str) {
        if let Ok(mut map) = self.conns.lock() {
            if let Some(conn) = map.remove(conn_id) {
                if let Some(h) = conn.reader {
                    h.abort();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    async fn echo_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(mut ws) = accept_async(stream).await {
                    while let Some(Ok(msg)) = ws.next().await {
                        if msg.is_text() || msg.is_binary() {
                            let _ = ws.send(msg).await;
                        }
                    }
                }
            }
        });
        format!("ws://127.0.0.1:{port}")
    }

    #[tokio::test]
    async fn connect_send_and_echo_roundtrip() {
        let url = echo_server().await;
        let mgr = WsManager::new();
        let got = Arc::new(Mutex::new(Vec::<String>::new()));
        let opened = Arc::new(AtomicBool::new(false));
        let got2 = got.clone();
        let opened2 = opened.clone();
        let sink: WsEventSink = Arc::new(move |ev| match ev {
            WsEvent::Message(m) => got2.lock().unwrap().push(m.data),
            WsEvent::Status("open") => opened2.store(true, Ordering::SeqCst),
            _ => {}
        });

        mgr.connect("c1".into(), url, vec![], sink).await.unwrap();
        assert!(opened.load(Ordering::SeqCst));
        assert!(mgr.is_connected("c1"));

        mgr.send_message("c1", WsMessageKind::Text, "hello".into())
            .unwrap();
        for _ in 0..50 {
            if !got.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(got.lock().unwrap().as_slice(), &["hello".to_string()]);

        mgr.disconnect("c1");
        assert!(!mgr.is_connected("c1"));
    }

    #[tokio::test]
    async fn send_to_unknown_connection_errors() {
        let mgr = WsManager::new();
        assert!(matches!(
            mgr.send_message("nope", WsMessageKind::Text, "x".into()),
            Err(VoleeoError::WebSocketClosed)
        ));
    }
}
