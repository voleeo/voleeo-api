//! NTLM (NTLMv2) over HTTP. NTLM authenticates a *connection*, not a request, so
//! the Type1 → Type2 → Type3 handshake must run on one keep-alive connection — we
//! open a dedicated `hyper` http1 connection (TLS via rustls) instead of reusing
//! the pooled `reqwest` client, whose pool can't guarantee connection affinity.
//!
//! Scoped v1: NTLMv2 only, HTTP/1.1, no redirects, no proxy, no cookie jar. The
//! body is buffered and replayed on the authenticate leg. Each scope cut surfaces
//! a timeline `info` note when it actually drops something.

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use base64::Engine;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::header::{HeaderName, HeaderValue};
use hyper_util::rt::TokioIo;
use ntlmclient::{Credentials, Flags, Message};
use tokio::net::TcpStream;
use voleeo_core::{
    BodyKind, HttpFailure, HttpRequest, HttpResponse, HttpResponseHeader, HttpTiming, RequestBody,
    TimelineEvent, VoleeoError,
};

use crate::fmt::push_event;

/// Resolved NTLM credentials (templates already expanded upstream).
pub struct NtlmCreds {
    pub username: String,
    pub password: String,
    pub domain: String,
    pub workstation: String,
}

const WORKSTATION_FALLBACK: &str = "WORKSTATION";
const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// `events` carries the timeline so a failure still shows what happened.
macro_rules! tryf {
    ($events:expr, $started:expr, $e:expr) => {
        match $e {
            Ok(v) => v,
            Err(err) => {
                let msg = err.to_string();
                push_event(&mut $events, $started, "error", msg.clone());
                return Err(VoleeoError::HttpFailed(HttpFailure {
                    message: msg,
                    events: $events,
                }));
            }
        }
    };
}

fn negotiate_message() -> Result<Vec<u8>, VoleeoError> {
    let flags = Flags::NEGOTIATE_UNICODE
        | Flags::REQUEST_TARGET
        | Flags::NEGOTIATE_NTLM
        | Flags::NEGOTIATE_ALWAYS_SIGN
        | Flags::NEGOTIATE_NTLM2_KEY; // extended session security (NTLMv2)
    Message::Negotiate(ntlmclient::NegotiateMessage {
        flags,
        supplied_domain: String::new(),
        supplied_workstation: String::new(),
        os_version: Default::default(),
    })
    .to_bytes()
    .map_err(|e| VoleeoError::Http(format!("NTLM negotiate encode failed: {e:?}")))
}

/// Parse the Type2 challenge → compute the Type3 authenticate bytes + the target
/// name (for the timeline).
fn authenticate_message(type2: &[u8], creds: &NtlmCreds) -> Result<(Vec<u8>, String), VoleeoError> {
    let msg = Message::try_from(type2)
        .map_err(|e| VoleeoError::Http(format!("NTLM challenge parse failed: {e:?}")))?;
    let Message::Challenge(challenge) = msg else {
        return Err(VoleeoError::Http(
            "expected an NTLM Challenge message".into(),
        ));
    };
    // The NTLMv2 proof hashes over the server's *exact* target-info bytes
    // (terminator AV-pair included), so reserialize them byte-for-byte.
    let target_info: Vec<u8> = challenge
        .target_information
        .iter()
        .flat_map(|e| e.to_bytes())
        .collect();
    let c = Credentials {
        username: creds.username.clone(),
        password: creds.password.clone(),
        domain: creds.domain.clone(),
    };
    let resp = ntlmclient::respond_challenge_ntlm_v2(
        challenge.challenge,
        &target_info,
        ntlmclient::get_ntlm_time(),
        &c,
    );
    let workstation = if creds.workstation.trim().is_empty() {
        WORKSTATION_FALLBACK
    } else {
        creds.workstation.trim()
    };
    let bytes = resp
        .to_message(&c, workstation, challenge.flags)
        .to_bytes()
        .map_err(|e| VoleeoError::Http(format!("NTLM authenticate encode failed: {e:?}")))?;
    Ok((bytes, challenge.target_name))
}

/// Content type the authenticate leg sets for a reproducible body kind.
fn content_type_for(kind: &BodyKind) -> Option<&'static str> {
    match kind {
        BodyKind::Json | BodyKind::Graphql => Some("application/json"),
        BodyKind::Xml => Some("application/xml"),
        BodyKind::Text => Some("text/plain"),
        BodyKind::Html => Some("text/html"),
        BodyKind::FormUrlEncoded => Some("application/x-www-form-urlencoded"),
        BodyKind::None | BodyKind::Multipart | BodyKind::Binary => None,
    }
}

/// Body bytes the authenticate leg sends, plus an implicit content type. Scoped
/// v1 covers text-like + form bodies; multipart/binary return `false` so the
/// caller can note the drop.
fn request_body(body: Option<&RequestBody>) -> (Bytes, Option<&'static str>, bool) {
    let Some(body) = body else {
        return (Bytes::new(), None, true);
    };
    match crate::body::reproducible_body_bytes(body) {
        Some(bytes) => (Bytes::from(bytes), content_type_for(&body.kind), true),
        // Reproducing multipart boundaries / streaming files is out of v1 scope.
        None => (Bytes::new(), None, false),
    }
}

/// Drive the NTLM handshake over one connection and return the final response.
pub async fn send_ntlm(
    request: &HttpRequest,
    creds: NtlmCreds,
    started: Instant,
) -> Result<HttpResponse, VoleeoError> {
    let request_id = request.id.clone();
    let url_str = crate::executor::normalize_url(&request.url)?;
    let url = reqwest::Url::parse(&url_str)
        .map_err(|e| VoleeoError::Http(format!("Invalid URL: {e}")))?;
    let method = crate::executor::effective_method(request)?;
    let https = url.scheme() == "https";
    let host = url.host_str().unwrap_or("").to_string();
    if host.is_empty() {
        return Err(VoleeoError::Http("NTLM: URL has no host".into()));
    }
    let port = url
        .port_or_known_default()
        .unwrap_or(if https { 443 } else { 80 });
    let host_header = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.clone(),
    };
    let target = {
        let mut p = url.path().to_string();
        if let Some(q) = url.query() {
            p.push('?');
            p.push_str(q);
        }
        if p.is_empty() {
            "/".into()
        } else {
            p
        }
    };

    let (body_bytes, body_ct, body_ok) = request_body(request.body.as_ref());

    let mut events: Vec<TimelineEvent> = Vec::new();
    push_event(
        &mut events,
        started,
        "config",
        format!(
            "NTLM — dedicated single connection, HTTP/1.1{}",
            if https { " + TLS" } else { "" }
        ),
    );
    if !body_ok {
        push_event(
            &mut events,
            started,
            "info",
            "NTLM v1 — multipart/binary body not sent (scoped out)",
        );
    }
    push_event(
        &mut events,
        started,
        "send",
        format!("{method} {target} HTTP/1.1"),
    );
    push_event(&mut events, started, "send", format!("Host: {host_header}"));

    // Connect (one connection for the whole handshake).
    let tcp = tryf!(
        events,
        started,
        TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| format!("NTLM connect failed: {e}"))
    );
    tcp.set_nodelay(true).ok();

    let mut sender = if https {
        let tls = tryf!(events, started, tls_connect(tcp, &host).await);
        tryf!(events, started, spawn_http1(TokioIo::new(tls)).await)
    } else {
        tryf!(events, started, spawn_http1(TokioIo::new(tcp)).await)
    };

    // Leg 1 — Negotiate (Type 1), empty body so we don't ship the payload twice.
    let negotiate = negotiate_message()?;
    let req1 = build_request(
        &method,
        &target,
        &host_header,
        request,
        &format!("NTLM {}", B64.encode(&negotiate)),
        None,
        Full::new(Bytes::new()),
    )?;
    push_event(
        &mut events,
        started,
        "auth",
        "NTLM — negotiate (Type 1) sent",
    );
    let resp1 = tryf!(
        events,
        started,
        sender
            .send_request(req1)
            .await
            .map_err(|e| format!("NTLM negotiate send failed: {e}"))
    );
    let cap1 = tryf!(events, started, capture(resp1).await);
    push_event(
        &mut events,
        started,
        "recv",
        format!("HTTP/1.1 {} {}", cap1.status, cap1.status_text),
    );

    // No NTLM challenge → the server answered outright; surface that response.
    let Some(type2_b64) = ntlm_challenge(&cap1.headers) else {
        return Ok(build_response(request_id, cap1, events, started));
    };
    let type2 = tryf!(
        events,
        started,
        B64.decode(type2_b64.trim())
            .map_err(|e| format!("NTLM challenge base64 invalid: {e}"))
    );
    let (type3, target_name) = authenticate_message(&type2, &creds)?;
    push_event(
        &mut events,
        started,
        "auth",
        format!("NTLM — challenge (Type 2) received, target \"{target_name}\""),
    );
    push_event(
        &mut events,
        started,
        "auth",
        "NTLM — authenticate (Type 3) sent",
    );

    // Leg 2 — Authenticate (Type 3), real body, same connection.
    let req2 = build_request(
        &method,
        &target,
        &host_header,
        request,
        &format!("NTLM {}", B64.encode(&type3)),
        body_ct,
        Full::new(body_bytes),
    )?;
    let resp2 = tryf!(
        events,
        started,
        sender
            .send_request(req2)
            .await
            .map_err(|e| format!("NTLM authenticate send failed: {e}"))
    );
    let cap2 = tryf!(events, started, capture(resp2).await);
    push_event(
        &mut events,
        started,
        "recv",
        format!("HTTP/1.1 {} {}", cap2.status, cap2.status_text),
    );
    Ok(build_response(request_id, cap2, events, started))
}

/// First `WWW-Authenticate: NTLM <base64>` token, if any.
fn ntlm_challenge(headers: &[(String, String)]) -> Option<String> {
    headers
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("www-authenticate"))
        .find_map(|(_, v)| {
            v.strip_prefix("NTLM ")
                .or_else(|| v.strip_prefix("ntlm "))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

async fn spawn_http1<IO>(
    io: IO,
) -> Result<hyper::client::conn::http1::SendRequest<Full<Bytes>>, String>
where
    IO: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    let (sender, conn) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|e| format!("NTLM HTTP handshake failed: {e}"))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    Ok(sender)
}

/// Build the rustls connector once: loading the OS trust store is blocking I/O,
/// and the config is identical for every send.
fn build_tls_connector() -> Result<tokio_rustls::TlsConnector, String> {
    let mut roots = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(cert);
    }
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| format!("NTLM TLS config failed: {e}"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(tokio_rustls::TlsConnector::from(Arc::new(config)))
}

/// Process-lifetime connector: the first NTLM HTTPS send loads native certs off
/// the runtime via `spawn_blocking`; later sends reuse the cached `Arc`.
async fn tls_connector() -> Result<tokio_rustls::TlsConnector, String> {
    static CACHE: OnceLock<tokio_rustls::TlsConnector> = OnceLock::new();
    if let Some(c) = CACHE.get() {
        return Ok(c.clone());
    }
    let connector = tokio::task::spawn_blocking(build_tls_connector)
        .await
        .map_err(|e| format!("NTLM TLS init join failed: {e}"))??;
    Ok(CACHE.get_or_init(|| connector).clone())
}

async fn tls_connect(
    tcp: TcpStream,
    host: &str,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, String> {
    let connector = tls_connector().await?;
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("NTLM TLS server name invalid: {e}"))?;
    connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("NTLM TLS handshake failed: {e}"))
}

fn build_request(
    method: &reqwest::Method,
    target: &str,
    host_header: &str,
    request: &HttpRequest,
    auth_value: &str,
    content_type: Option<&str>,
    body: Full<Bytes>,
) -> Result<hyper::Request<Full<Bytes>>, VoleeoError> {
    let mut builder = hyper::Request::builder()
        .method(method.clone())
        .uri(target)
        .header(hyper::header::HOST, host_header)
        .header(hyper::header::AUTHORIZATION, auth_value);
    let mut has_ct = false;
    for h in request
        .headers
        .iter()
        .filter(|h| h.enabled && !h.name.trim().is_empty())
    {
        let lc = h.name.trim().to_ascii_lowercase();
        // Host / Authorization / Content-Length are managed here.
        if lc == "host" || lc == "authorization" || lc == "content-length" {
            continue;
        }
        if lc == "content-type" {
            has_ct = true;
        }
        let name = HeaderName::from_bytes(h.name.trim().as_bytes())
            .map_err(|_| VoleeoError::Http(format!("Invalid header name: {}", h.name)))?;
        let value = HeaderValue::from_str(&h.value)
            .map_err(|_| VoleeoError::Http(format!("Invalid header value for {}", h.name)))?;
        builder = builder.header(name, value);
    }
    if let Some(ct) = content_type {
        if !has_ct {
            builder = builder.header(hyper::header::CONTENT_TYPE, ct);
        }
    }
    builder
        .body(body)
        .map_err(|e| VoleeoError::Http(format!("NTLM request build failed: {e}")))
}

struct Captured {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: Bytes,
}

async fn capture(resp: hyper::Response<hyper::body::Incoming>) -> Result<Captured, String> {
    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp
        .into_body()
        .collect()
        .await
        .map_err(|e| format!("NTLM read body failed: {e}"))?
        .to_bytes();
    Ok(Captured {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

fn build_response(
    request_id: String,
    cap: Captured,
    mut events: Vec<TimelineEvent>,
    started: Instant,
) -> HttpResponse {
    let at_ms = started.elapsed().as_secs_f64() * 1000.0;
    for (name, value) in &cap.headers {
        events.push(TimelineEvent {
            at_ms,
            kind: "header".into(),
            text: format!("{name}: {value}"),
        });
    }
    let headers: Vec<HttpResponseHeader> = cap
        .headers
        .into_iter()
        .map(|(name, value)| HttpResponseHeader { name, value, at_ms })
        .collect();

    let body_bytes = cap.body.to_vec();
    let body_size = u32::try_from(body_bytes.len()).unwrap_or(u32::MAX);
    let (body, body_is_text) = if body_bytes.is_empty() {
        (String::new(), true)
    } else {
        match String::from_utf8(body_bytes.clone()) {
            Ok(s) => (s, true),
            Err(_) => (B64.encode(&body_bytes), false),
        }
    };

    let total = started.elapsed().as_secs_f64() * 1000.0;
    HttpResponse {
        request_id,
        status: cap.status,
        status_text: cap.status_text,
        headers,
        body,
        body_size,
        body_is_text,
        body_windowed: false,
        body_line_count: 0,
        response_id: String::new(),
        timing: HttpTiming {
            dns_ms: 0.0,
            connect_ms: 0.0,
            tls_ms: 0.0,
            first_byte_ms: total,
            download_ms: 0.0,
            total_ms: total,
        },
        events,
        redirect_warning: None,
        captured_cookies: Vec::new(),
        attached_cookies: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A canned Type2 challenge (base64) from a go-httpbin-style server, with a
    // realm and a target-info block — exercises the parse → Type3 round-trip.
    const TYPE2_B64: &str = "TlRMTVNTUAACAAAADAAMADgAAAABAoACASNFZ4mrze8AAAAAAAAAACwALABEAAAABgGxHQAAAA9TAEUAUgBWAEUAUgABAAwAUwBFAFIAVgBFAFIAAgAIAEMATwBSAFAABwAIAAAAAAAAAAAAAAAAAA==";

    #[test]
    fn negotiate_message_is_well_formed() {
        let bytes = negotiate_message().unwrap();
        // "NTLMSSP\0" signature + message type 1.
        assert_eq!(&bytes[0..8], b"NTLMSSP\0");
        assert_eq!(bytes[8], 1);
    }

    #[test]
    fn computes_type3_from_challenge() {
        let type2 = B64.decode(TYPE2_B64).unwrap();
        let creds = NtlmCreds {
            username: "alice".into(),
            password: "s3cret".into(),
            domain: "CORP".into(),
            workstation: String::new(),
        };
        let (type3, target) = authenticate_message(&type2, &creds).unwrap();
        assert_eq!(&type3[0..8], b"NTLMSSP\0");
        assert_eq!(type3[8], 3, "message type 3 (Authenticate)");
        assert_eq!(target, "SERVER");
    }

    #[test]
    fn ntlm_challenge_extracts_token() {
        let headers = vec![
            ("Content-Type".into(), "text/html".into()),
            ("WWW-Authenticate".into(), "NTLM TlRMTVNT".into()),
        ];
        assert_eq!(ntlm_challenge(&headers).as_deref(), Some("TlRMTVNT"));
    }
}
