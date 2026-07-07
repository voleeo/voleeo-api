mod auth;
pub use auth::sign_dynamic_auth_url;
mod auth_retry;
mod body;
mod cookie_provider;
mod dns;
mod executor;
mod fmt;
mod ntlm;
mod redirect;
mod send_body;
mod sse;
mod sse_accum;
pub use sse_accum::SseAccum;

use redirect::RedirectHop;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use voleeo_core::{
    DnsOverride, HttpRequest, HttpResponse, HttpResponseHeader, SseFrame, StoredCookie,
    TimelineEvent, VoleeoError,
};

pub enum SseEvent {
    Open {
        status: u16,
        status_text: String,
        headers: Vec<HttpResponseHeader>,
        events: Vec<TimelineEvent>,
        captured_cookies: Vec<StoredCookie>,
        attached_cookies: Vec<StoredCookie>,
    },
    Frame {
        frame: SseFrame,
        timeline: TimelineEvent,
    },
}

pub type SseSink = Arc<dyn Fn(SseEvent) + Send + Sync>;

pub(crate) const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
pub(crate) const MAX_REDIRECTS: usize = 10;

/// Per-send cancel entry: (send token, cancel sender). The token lets a
/// completing send remove only its own handle, never a later send's.
type CancelEntry = (u64, tokio::sync::oneshot::Sender<()>);

tokio::task_local! {
    pub(crate) static REQ_START: Instant;
    pub(crate) static REDIRECT_SINK: Arc<Mutex<Vec<RedirectHop>>>;
    /// Outgoing cookie set the provider matches per request. Empty = no jar.
    pub(crate) static ATTACH_COOKIES: Arc<Vec<StoredCookie>>;
    /// Provider drops `Set-Cookie` cookies here (incl. redirect hops).
    pub(crate) static CAPTURE_SINK: Arc<Mutex<Vec<StoredCookie>>>;
    /// Provider records each outgoing `Cookie:` here so the Response tab shows
    /// what was actually sent, across hops.
    pub(crate) static ATTACHED_SINK: Arc<Mutex<Vec<StoredCookie>>>;
    /// Active workspace DNS overrides for this send. The custom resolver reads
    /// this and prefers any hostname match over system DNS.
    pub(crate) static DNS_OVERRIDES: Arc<Vec<(String, IpAddr)>>;
    /// When true, the resolver refuses link-local / cloud-metadata targets.
    /// Set by `send_guarded` for AI/MCP-initiated sends; re-evaluated on every
    /// redirect hop because reqwest re-resolves each hop through the resolver.
    pub(crate) static GUARD_INTERNAL: bool;
    /// Present for `send_streamed`; the body reader pushes each parsed SSE frame
    /// here instead of buffering. `None` for plain sends.
    pub(crate) static SSE_SINK: Option<SseSink>;
}

/// Shared HTTP client: one `reqwest::Client` (and its connection pool) reused
/// across all sends. `Clone` is cheap — every field is `Arc`.
#[derive(Debug, Clone)]
pub struct HttpExecutor {
    pub(crate) client: reqwest::Client,
    /// Last successful send per `(host, port)` — not bumped on failure, so a
    /// timeout doesn't refresh the connection-reuse heuristic.
    pub(crate) last_seen: Arc<Mutex<HashMap<(String, u16), Instant>>>,
    /// Cancel handles by request id. Raced against `send_inner` in `select!`;
    /// firing drops the future, aborting the reqwest call. Each entry is tagged
    /// with the send's token so a completing send only removes its *own* handle —
    /// a later send for the same id (which replaced the entry) survives cleanup.
    pub(crate) in_flight: Arc<Mutex<HashMap<String, CancelEntry>>>,
    /// Monotonic send-token source; disambiguates concurrent sends per request id.
    pub(crate) send_seq: Arc<AtomicU64>,
}

impl HttpExecutor {
    /// Builds the executor. The client carries a redirect policy that logs hops
    /// via task-locals (set in `send`) and a cookie provider that captures
    /// cookies on intermediate redirects before following.
    pub fn new() -> Result<Self, VoleeoError> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS {
                    return attempt.error(format!("too many redirects (max {MAX_REDIRECTS})"));
                }
                // Guarded (AI/MCP) sends: a redirect to a literal-IP metadata/
                // link-local target skips the DNS resolver's guard, so reject it
                // here directly. Hostname hops are still caught by the resolver.
                let guarded = GUARD_INTERNAL.try_with(|g| *g).unwrap_or(false);
                if guarded {
                    if let Some(ip) = attempt
                        .url()
                        .host_str()
                        .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
                    {
                        if voleeo_core::is_link_local_or_metadata(ip) {
                            return attempt.error(format!(
                                "blocked redirect to internal/link-local address {ip}"
                            ));
                        }
                    }
                }
                // Records only when polled inside a `send` scope.
                let _ = REQ_START.try_with(|started| {
                    let at_ms = started.elapsed().as_secs_f64() * 1000.0;
                    let status = attempt.status().as_u16();
                    let to = attempt.url().to_string();
                    let _ = REDIRECT_SINK.try_with(|sink| {
                        if let Ok(mut hops) = sink.lock() {
                            hops.push(RedirectHop { status, to, at_ms });
                        }
                    });
                });
                attempt.follow()
            }))
            .cookie_provider(Arc::new(cookie_provider::TaskLocalCookieJar))
            .dns_resolver(Arc::new(dns::TaskLocalResolver))
            .pool_idle_timeout(POOL_IDLE_TIMEOUT)
            .use_rustls_tls()
            .build()
            .map_err(|e| VoleeoError::Http(e.to_string()))?;

        Ok(Self {
            client,
            last_seen: Arc::new(Mutex::new(HashMap::new())),
            in_flight: Arc::new(Mutex::new(HashMap::new())),
            send_seq: Arc::new(AtomicU64::new(0)),
        })
    }

    /// Abort an in-flight send (no-op if not running); the waiting `send`
    /// returns `Err(VoleeoError::Cancelled)`.
    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut map) = self.in_flight.lock() {
            if let Some((_, tx)) = map.remove(request_id) {
                let _ = tx.send(());
            }
        }
    }

    /// Send and return the response. `attach_cookies` sources the outgoing
    /// `Cookie:` header; the provider matches it against each request URL (incl.
    /// redirect hops). Captured `Set-Cookie`s ride out on
    /// `HttpResponse.captured_cookies`. Concurrent sends are safe; call
    /// `cancel(request.id)` from another task to abort.
    pub async fn send(
        &self,
        request: &HttpRequest,
        attach_cookies: Vec<StoredCookie>,
        dns_overrides: Vec<DnsOverride>,
    ) -> Result<HttpResponse, VoleeoError> {
        self.send_scoped(request, attach_cookies, dns_overrides, false, None)
            .await
    }

    /// Like `send`, but when the response is `text/event-stream` each parsed
    /// frame is pushed to `sse_sink` live (and the stored body is left empty).
    /// Non-SSE responses behave exactly like `send`. Cancellation is unchanged —
    /// `cancel(request.id)` aborts an in-flight stream.
    pub async fn send_streamed(
        &self,
        request: &HttpRequest,
        attach_cookies: Vec<StoredCookie>,
        dns_overrides: Vec<DnsOverride>,
        sse_sink: SseSink,
    ) -> Result<HttpResponse, VoleeoError> {
        self.send_scoped(
            request,
            attach_cookies,
            dns_overrides,
            false,
            Some(sse_sink),
        )
        .await
    }

    /// Like `send`, but refuses to connect to link-local / cloud-metadata
    /// addresses (re-checked on each redirect hop). Use for AI/MCP-initiated
    /// sends, where the destination is not vetted by a human.
    pub async fn send_guarded(
        &self,
        request: &HttpRequest,
        attach_cookies: Vec<StoredCookie>,
        dns_overrides: Vec<DnsOverride>,
    ) -> Result<HttpResponse, VoleeoError> {
        self.send_scoped(request, attach_cookies, dns_overrides, true, None)
            .await
    }

    async fn send_scoped(
        &self,
        request: &HttpRequest,
        attach_cookies: Vec<StoredCookie>,
        dns_overrides: Vec<DnsOverride>,
        guard_internal: bool,
        sse_sink: Option<SseSink>,
    ) -> Result<HttpResponse, VoleeoError> {
        let resolved_overrides: Arc<Vec<(String, IpAddr)>> = Arc::new(
            dns_overrides
                .into_iter()
                .filter(|o| o.enabled && !o.hostname.trim().is_empty())
                .filter_map(|o| {
                    o.address
                        .trim()
                        .parse::<IpAddr>()
                        .ok()
                        .map(|ip| (o.hostname.trim().to_ascii_lowercase(), ip))
                })
                .collect(),
        );
        let started = Instant::now();
        let sink: Arc<Mutex<Vec<RedirectHop>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_clone = sink.clone();
        let attach = Arc::new(attach_cookies);
        let capture: Arc<Mutex<Vec<StoredCookie>>> = Arc::new(Mutex::new(Vec::new()));
        let capture_clone = capture.clone();
        let attached: Arc<Mutex<Vec<StoredCookie>>> = Arc::new(Mutex::new(Vec::new()));
        let attached_clone = attached.clone();

        // Register cancel channel; abort any stale send for this id (defensive).
        // Tag with a monotonic token so cleanup below removes only *this* send —
        // a concurrent send B that replaced our entry keeps its own handle.
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let request_id = request.id.clone();
        let token = self.send_seq.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut map) = self.in_flight.lock() {
            if let Some((_, prev)) = map.insert(request_id.clone(), (token, cancel_tx)) {
                let _ = prev.send(());
            }
        }

        let result = SSE_SINK
            .scope(
                sse_sink,
                GUARD_INTERNAL.scope(
                    guard_internal,
                    REQ_START.scope(
                        started,
                        REDIRECT_SINK.scope(
                            sink_clone,
                            ATTACH_COOKIES.scope(
                                attach.clone(),
                                CAPTURE_SINK.scope(
                                    capture_clone,
                                    ATTACHED_SINK.scope(
                                        attached_clone,
                                        DNS_OVERRIDES.scope(resolved_overrides, async {
                                            tokio::select! {
                                                biased;
                                                _ = cancel_rx => Err(VoleeoError::Cancelled),
                                                r = self.send_with_auth_retry(request, started, sink, &attach, &capture, &attached) => r,
                                            }
                                        }),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            )
            .await;

        // Remove only if our token still owns the entry — a later send for the
        // same id may have replaced it, and dropping *that* handle would silently
        // disarm its cancel.
        if let Ok(mut map) = self.in_flight.lock() {
            if map.get(&request_id).is_some_and(|(t, _)| *t == token) {
                map.remove(&request_id);
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{AuthConfig, BodyField, BodyKind, HttpRequest, RequestBody};

    fn bare_request(url: &str, method: &str) -> HttpRequest {
        HttpRequest {
            id: "test-req".into(),
            request_type: "http".into(),
            model: "request".into(),
            workspace_id: "ws".into(),
            folder_id: None,
            method: method.into(),
            name: "Test".into(),
            url: url.into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    /// Spawn a minimal HTTP/1.1 server that reads one request then responds with
    /// the given raw bytes. Returns the port it's bound on.
    async fn spawn_server(response: Vec<u8>) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let _ = stream.read(&mut buf).await;
                let _ = stream.write_all(&response).await;
            }
        });
        port
    }

    fn ok_response(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    /// Accept one request, hand its raw bytes (headers + body) back over a
    /// channel, and reply 200 — lets a test assert what the executor actually
    /// put on the wire for a given body kind.
    async fn spawn_capturing_server() -> (u16, tokio::sync::oneshot::Receiver<Vec<u8>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = vec![0u8; 65536];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                buf.truncate(n);
                let _ = stream.write_all(&ok_response("ok")).await;
                let _ = tx.send(buf);
            }
        });
        (port, rx)
    }

    fn bfield(name: &str, value: &str, is_file: bool) -> BodyField {
        BodyField {
            id: "x".into(),
            name: name.into(),
            value: value.into(),
            enabled: true,
            is_file,
            content_type: None,
        }
    }

    fn temp_file(tag: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("voleeo_http_test_{}_{tag}", std::process::id()));
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[tokio::test]
    async fn send_form_urlencoded_body() {
        let (port, rx) = spawn_capturing_server().await;
        let ex = HttpExecutor::new().unwrap();
        let mut req = bare_request(&format!("http://127.0.0.1:{port}/"), "POST");
        req.body = Some(RequestBody {
            kind: BodyKind::FormUrlEncoded,
            fields: Some(vec![bfield("a", "1", false), bfield("b", "two", false)]),
            ..Default::default()
        });
        ex.send(&req, Vec::new(), Vec::new()).await.unwrap();

        let got = String::from_utf8_lossy(&rx.await.unwrap()).to_lowercase();
        assert!(got.contains("content-type: application/x-www-form-urlencoded"));
        assert!(
            got.contains("a=1&b=two"),
            "form body not on the wire: {got}"
        );
    }

    #[tokio::test]
    async fn send_form_skips_disabled_fields() {
        let (port, rx) = spawn_capturing_server().await;
        let ex = HttpExecutor::new().unwrap();
        let mut req = bare_request(&format!("http://127.0.0.1:{port}/"), "POST");
        let mut off = bfield("skip", "no", false);
        off.enabled = false;
        req.body = Some(RequestBody {
            kind: BodyKind::FormUrlEncoded,
            fields: Some(vec![bfield("keep", "yes", false), off]),
            ..Default::default()
        });
        ex.send(&req, Vec::new(), Vec::new()).await.unwrap();

        let got = String::from_utf8_lossy(&rx.await.unwrap()).to_string();
        assert!(got.contains("keep=yes"));
        assert!(!got.contains("skip"), "disabled field leaked: {got}");
    }

    #[tokio::test]
    async fn send_binary_body_from_file() {
        let file = temp_file("bin.dat", &[1, 2, 3, 4, 5]);
        let (port, rx) = spawn_capturing_server().await;
        let ex = HttpExecutor::new().unwrap();
        let mut req = bare_request(&format!("http://127.0.0.1:{port}/"), "PUT");
        req.body = Some(RequestBody {
            kind: BodyKind::Binary,
            file_path: Some(file.to_string_lossy().into_owned()),
            content_type: Some("application/pdf".into()),
            ..Default::default()
        });
        ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        let raw = rx.await.unwrap();
        let _ = std::fs::remove_file(&file);

        assert!(String::from_utf8_lossy(&raw)
            .to_lowercase()
            .contains("content-type: application/pdf"));
        assert!(raw.ends_with(&[1, 2, 3, 4, 5]), "file bytes not sent");
    }

    #[tokio::test]
    async fn send_multipart_with_text_and_file() {
        let file = temp_file("part.txt", b"file-contents");
        let (port, rx) = spawn_capturing_server().await;
        let ex = HttpExecutor::new().unwrap();
        let mut req = bare_request(&format!("http://127.0.0.1:{port}/"), "POST");
        req.body = Some(RequestBody {
            kind: BodyKind::Multipart,
            fields: Some(vec![
                bfield("field", "text-value", false),
                bfield("upload", &file.to_string_lossy(), true),
            ]),
            ..Default::default()
        });
        ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        let got = String::from_utf8_lossy(&rx.await.unwrap()).to_string();
        let _ = std::fs::remove_file(&file);

        assert!(got
            .to_lowercase()
            .contains("multipart/form-data; boundary="));
        assert!(got.contains("name=\"field\""));
        assert!(got.contains("text-value"));
        assert!(got.contains("name=\"upload\""));
        assert!(got.contains("file-contents"));
    }

    #[tokio::test]
    async fn executor_new_succeeds() {
        assert!(HttpExecutor::new().is_ok());
    }

    #[tokio::test]
    async fn cancel_is_noop_when_no_request_in_flight() {
        let ex = HttpExecutor::new().unwrap();
        ex.cancel("nonexistent-id");
    }

    /// Send A registers, send B replaces it (aborting A), then A's cleanup runs.
    /// The token guard must leave B's handle intact so `cancel` still reaches B.
    #[tokio::test]
    async fn late_send_cleanup_does_not_orphan_replacement_cancel_handle() {
        let ex = HttpExecutor::new().unwrap();
        let id = "shared-id".to_string();

        // A registers with token 0.
        let (a_tx, mut a_rx) = tokio::sync::oneshot::channel::<()>();
        let token_a = ex.send_seq.fetch_add(1, Ordering::Relaxed);
        {
            let mut map = ex.in_flight.lock().unwrap();
            map.insert(id.clone(), (token_a, a_tx));
        }

        // B registers for the same id (token 1), aborting A and replacing the entry.
        let (b_tx, mut b_rx) = tokio::sync::oneshot::channel::<()>();
        let token_b = ex.send_seq.fetch_add(1, Ordering::Relaxed);
        {
            let mut map = ex.in_flight.lock().unwrap();
            if let Some((_, prev)) = map.insert(id.clone(), (token_b, b_tx)) {
                let _ = prev.send(()); // aborts A
            }
        }
        assert!(a_rx.try_recv().is_ok(), "A should have been cancelled by B");

        // A's cleanup runs: its token no longer owns the entry, so it must NOT remove B.
        {
            let mut map = ex.in_flight.lock().unwrap();
            if map.get(&id).is_some_and(|(t, _)| *t == token_a) {
                map.remove(&id);
            }
        }

        // cancel() must still reach B's live handle.
        ex.cancel(&id);
        assert!(b_rx.try_recv().is_ok(), "cancel must still reach B");
    }

    #[tokio::test]
    async fn send_returns_status_and_text_body() {
        let port = spawn_server(ok_response("hello")).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, "hello");
        assert!(resp.body_is_text);
    }

    #[tokio::test]
    async fn send_streamed_emits_sse_frames_and_empties_body() {
        let body = "data: {\"n\":1}\n\ndata: {\"n\":2}\n\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes();
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");

        let frames = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let opened = std::sync::Arc::new(std::sync::Mutex::new(0u16));
        let collected = frames.clone();
        let opened_w = opened.clone();
        let sink: crate::SseSink = std::sync::Arc::new(move |ev| match ev {
            crate::SseEvent::Open { status, .. } => *opened_w.lock().unwrap() = status,
            crate::SseEvent::Frame { frame, .. } => collected.lock().unwrap().push(frame),
        });
        let resp = ex
            .send_streamed(&req, Vec::new(), Vec::new(), sink)
            .await
            .unwrap();

        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, "", "SSE body is streamed, not buffered");
        assert_eq!(*opened.lock().unwrap(), 200, "Open carries the status");
        let got = frames.lock().unwrap();
        assert_eq!(got.len(), 2, "both frames pushed to the sink");
        assert_eq!(got[0].data, "{\"n\":1}");
        assert_eq!(got[0].seq, 0);
        assert_eq!(got[1].seq, 1);
    }

    #[tokio::test]
    async fn send_without_sink_parses_sse_frames_and_terminates() {
        // A text/event-stream with no live sink (plain `send`, e.g. MCP) must still
        // parse frames into the response and NOT loop forever buffering the body.
        let body = "data: {\"n\":1}\n\ndata: {\"n\":2}\n\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes();
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();

        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, "", "SSE body isn't buffered into the body field");
        assert_eq!(resp.sse_frames.len(), 2, "frames parsed without a sink");
        assert_eq!(resp.sse_frames[0].data, "{\"n\":1}");
        assert_eq!(resp.sse_frames[0].seq, 0);
        assert_eq!(resp.sse_frames[1].seq, 1);
        // 7 data bytes per frame → cumulative size, not the empty body.
        assert_eq!(resp.body_size, 14);
    }

    #[tokio::test]
    async fn send_captures_response_headers() {
        let response =
            b"HTTP/1.1 200 OK\r\nX-Custom: test-value\r\nContent-Length: 0\r\n\r\n".to_vec();
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert!(
            resp.headers
                .iter()
                .any(|h| h.name.eq_ignore_ascii_case("x-custom") && h.value == "test-value"),
            "expected X-Custom header in response"
        );
    }

    #[tokio::test]
    async fn send_empty_body_is_text() {
        let response = b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".to_vec();
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "DELETE");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert_eq!(resp.status, 204);
        assert_eq!(resp.body, "");
        assert!(resp.body_is_text);
    }

    #[tokio::test]
    async fn send_binary_body_is_base64_encoded() {
        let mut response = b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n".to_vec();
        response.extend_from_slice(&[0xff, 0xfe, 0xfd]);
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert!(!resp.body_is_text);
        // base64([0xff, 0xfe, 0xfd]) = "//79" — verified manually
        assert_eq!(resp.body, "//79");
    }

    #[tokio::test]
    async fn send_invalid_url_returns_error() {
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request("not a url at all !!!", "GET");
        assert!(ex.send(&req, Vec::new(), Vec::new()).await.is_err());
    }

    #[tokio::test]
    async fn send_populates_timeline_events() {
        let port = spawn_server(ok_response("ok")).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert!(!resp.events.is_empty(), "timeline should have events");
        assert!(
            resp.events.iter().any(|e| e.kind == "done"),
            "should end with a done event"
        );
    }

    #[tokio::test]
    async fn send_records_request_id_in_response() {
        let port = spawn_server(ok_response("ok")).await;
        let ex = HttpExecutor::new().unwrap();
        let mut req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        req.id = "my-unique-id".into();
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert_eq!(resp.request_id, "my-unique-id");
    }

    #[tokio::test]
    async fn send_guarded_rejects_literal_metadata_ip_preflight() {
        // A literal-IP metadata target bypasses the DNS resolver's guard, so the
        // pre-flight check must reject it before any connection is attempted.
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request("http://169.254.169.254/latest/meta-data/", "GET");
        let err = ex
            .send_guarded(&req, Vec::new(), Vec::new())
            .await
            .expect_err("guarded send to link-local literal IP must fail");
        match err {
            VoleeoError::Http(m) => {
                assert!(m.contains("internal/link-local"), "unexpected message: {m}")
            }
            other => panic!("expected Http error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn send_captures_cookies_from_set_cookie() {
        let response =
            b"HTTP/1.1 200 OK\r\nSet-Cookie: session=abc; Path=/\r\nContent-Length: 0\r\n\r\n"
                .to_vec();
        let port = spawn_server(response).await;
        let ex = HttpExecutor::new().unwrap();
        let req = bare_request(&format!("http://127.0.0.1:{port}/"), "GET");
        let resp = ex.send(&req, Vec::new(), Vec::new()).await.unwrap();
        assert_eq!(resp.captured_cookies.len(), 1);
        assert_eq!(resp.captured_cookies[0].name, "session");
        assert_eq!(resp.captured_cookies[0].value, "abc");
    }
}
