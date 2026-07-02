use crate::fmt::{fmt_age, fmt_bytes, fmt_dur_ms, http_error_message, push_event, push_event_at};
use crate::redirect::{compute_redirect_warning, drain_redirect_hops, RedirectHop};
use crate::sse::{RawFrame, SseDecoder};
use crate::{
    HttpExecutor, SseAccum, SseEvent, SseSink, DNS_OVERRIDES, MAX_REDIRECTS, POOL_IDLE_TIMEOUT,
    SSE_SINK,
};
use base64::Engine;
use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use voleeo_core::{
    AuthConfig, HttpFailure, HttpRequest, HttpResponse, HttpResponseHeader, HttpTiming,
    RequestParameter, SseFrame, StoredCookie, TimelineEvent, VoleeoError,
};

/// Tag a parsed SSE frame with arrival metadata and hand it (plus its timeline
/// row) to the live sink. Bumps `seq` so each frame keys uniquely in the UI.
/// The row is NOT retained in the executor's `events` Vec — `SseAccum` keeps the
/// bounded copy the final response uses, so a fast/endless stream can't grow that
/// Vec one entry per frame.
fn push_sse_frame(sink: &SseSink, seq: &mut u32, started: Instant, raw: RawFrame) {
    let at_ms = started.elapsed().as_secs_f64() * 1000.0;
    let label = raw.event.as_deref().unwrap_or("message");
    let timeline = TimelineEvent {
        at_ms,
        kind: "recv".into(),
        text: format!("event: {label} · {} B", raw.data.len()),
    };
    let frame = SseFrame {
        seq: *seq,
        event: raw.event,
        data: raw.data,
        last_event_id: raw.id,
        retry: raw.retry,
        at_ms,
    };
    sink(SseEvent::Frame { frame, timeline });
    *seq += 1;
}

/// Log a body-stream read failure on the timeline and turn it into the error
/// (taking ownership of `events`); shared by the SSE and buffered read loops.
fn body_stream_err(
    events: &mut Vec<TimelineEvent>,
    started: Instant,
    e: reqwest::Error,
) -> VoleeoError {
    let msg = format!("Body stream failed: {e}");
    push_event(events, started, "error", msg.clone());
    VoleeoError::HttpFailed(HttpFailure {
        message: msg,
        events: std::mem::take(events),
    })
}

pub(crate) fn normalize_url(raw: &str) -> Result<String, VoleeoError> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(VoleeoError::Http("URL is empty".into()));
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        Ok(t.to_string())
    } else {
        Ok(format!("https://{t}"))
    }
}

pub(crate) fn parse_method(s: &str) -> Result<reqwest::Method, VoleeoError> {
    s.trim()
        .parse()
        .map_err(|_| VoleeoError::Http(format!("Invalid HTTP method: {s}")))
}

/// GraphQL bodies go over POST — the only send shape we build. The UI locks
/// the picker, but MCP updates and imports can store any method; enforce the
/// invariant at the wire, where every path converges.
pub(crate) fn effective_method(request: &HttpRequest) -> Result<reqwest::Method, VoleeoError> {
    let is_graphql = request
        .body
        .as_ref()
        .is_some_and(|b| matches!(b.kind, voleeo_core::BodyKind::Graphql));
    if is_graphql {
        Ok(reqwest::Method::POST)
    } else {
        parse_method(&request.method)
    }
}

impl HttpExecutor {
    /// Wraps `send_inner` with the Digest challenge-retry: a `401` carrying a
    /// `WWW-Authenticate: Digest` triggers one retry with the computed
    /// `Authorization` header. Both legs appear in the timeline, joined by an
    /// `auth` row. Any other scheme/status passes through unchanged.
    pub(crate) async fn send_with_auth_retry(
        &self,
        request: &HttpRequest,
        started: Instant,
        redirect_hops: Arc<Mutex<Vec<RedirectHop>>>,
        attach_cookies: &[StoredCookie],
        capture_sink: &Arc<Mutex<Vec<StoredCookie>>>,
        attached_sink: &Arc<Mutex<Vec<StoredCookie>>>,
    ) -> Result<HttpResponse, VoleeoError> {
        if let AuthConfig::Ntlm {
            username,
            password,
            domain,
            workstation,
            ..
        } = &request.auth
        {
            if request.auth.is_active() {
                return crate::ntlm::send_ntlm(
                    request,
                    crate::ntlm::NtlmCreds {
                        username: username.clone(),
                        password: password.clone(),
                        domain: domain.clone(),
                        workstation: workstation.clone(),
                    },
                    started,
                )
                .await;
            }
        }

        let first = self
            .send_inner(
                request,
                started,
                redirect_hops.clone(),
                attach_cookies,
                capture_sink,
                attached_sink,
            )
            .await?;

        if first.status != 401 || !matches!(request.auth, AuthConfig::Digest { .. }) {
            return Ok(first);
        }
        let www: Vec<&str> = first
            .headers
            .iter()
            .filter(|h| h.name.eq_ignore_ascii_case("www-authenticate"))
            .map(|h| h.value.as_str())
            .collect();
        let Some((header, note)) = crate::auth::digest_authorization(&request.auth, request, &www)
        else {
            return Ok(first); // disabled, or no usable Digest challenge
        };

        // Retry with the Authorization header; clear `auth` so the second leg
        // treats it as a plain header (no second challenge attempt).
        let mut retry = request.clone();
        retry.headers.push(RequestParameter {
            id: "__auth".into(),
            name: "Authorization".into(),
            value: header,
            enabled: true,
        });
        retry.auth = AuthConfig::None;
        let mut second = self
            .send_inner(
                &retry,
                started,
                redirect_hops,
                attach_cookies,
                capture_sink,
                attached_sink,
            )
            .await?;

        let mut events = first.events;
        push_event(&mut events, started, "auth", note);
        events.append(&mut second.events);
        second.events = events;
        Ok(second)
    }

    pub(crate) async fn send_inner(
        &self,
        request: &HttpRequest,
        started: Instant,
        redirect_hops: Arc<Mutex<Vec<RedirectHop>>>,
        attach_cookies: &[StoredCookie],
        capture_sink: &Arc<Mutex<Vec<StoredCookie>>>,
        attached_sink: &Arc<Mutex<Vec<StoredCookie>>>,
    ) -> Result<HttpResponse, VoleeoError> {
        let request_id = request.id.clone();
        let mut url = normalize_url(&request.url)?;
        let method = effective_method(request)?;
        let method_str = method.to_string();

        let mut parsed_url = reqwest::Url::parse(&url)
            .map_err(|e| VoleeoError::Http(format!("Invalid URL: {e}")))?;

        // Dynamic auth (SigV4, OAuth 1.0) signs the final request. Compute it here
        // so OAuth 1.0's query placement can append `oauth_*` to the URL before
        // the request is built; its headers/notes are applied below.
        let dynamic_auth = if request.auth.is_dynamic() {
            let signed = crate::auth::sign_dynamic_auth(
                &request.auth,
                &method_str,
                &parsed_url,
                request.body.as_ref(),
            )?;
            if !signed.query.is_empty() {
                for (k, v) in &signed.query {
                    parsed_url.query_pairs_mut().append_pair(k, v);
                }
                url = parsed_url.to_string();
            }
            Some(signed)
        } else {
            None
        };

        let host = parsed_url.host_str().unwrap_or("").to_string();
        let port = parsed_url.port_or_known_default().unwrap_or(0);
        let path = {
            let mut p = parsed_url.path().to_string();
            if let Some(q) = parsed_url.query() {
                p.push('?');
                p.push_str(q);
            }
            if p.is_empty() {
                "/".into()
            } else {
                p
            }
        };

        let mut events: Vec<voleeo_core::TimelineEvent> = Vec::new();
        let now_ms = || started.elapsed().as_secs_f64() * 1000.0;

        push_event(
            &mut events,
            started,
            "config",
            format!("redirects = follow (max {MAX_REDIRECTS})"),
        );
        push_event(&mut events, started, "config", "timeout = ∞");
        // accept-encoding header is set automatically by reqwest's gzip/br/deflate
        // features; we surface it so the user can verify what's negotiated. After
        // decompression reqwest strips Content-Encoding + Content-Length, so a
        // per-response compression ratio isn't recoverable here.
        push_event(
            &mut events,
            started,
            "config",
            "accept-encoding = gzip, br, deflate",
        );
        push_event(
            &mut events,
            started,
            "config",
            format!("pool-idle-timeout = {} s", POOL_IDLE_TIMEOUT.as_secs()),
        );

        push_event(
            &mut events,
            started,
            "send",
            format!("{method} {path} HTTP/1.1"),
        );
        if !host.is_empty() {
            push_event(&mut events, started, "send", format!("Host: {host}"));
        }

        // Surface which jar cookies the request will carry. The cookie provider
        // does the actual attachment (and re-matches on each redirect hop), but
        // logging here gives a deterministic baseline for the first hop.
        let user_set_cookie = request
            .headers
            .iter()
            .any(|h| h.enabled && h.name.trim().eq_ignore_ascii_case("cookie"));
        if !user_set_cookie && !attach_cookies.is_empty() {
            let now = chrono::Utc::now();
            let matched = voleeo_cookies::matching::matching(attach_cookies, &parsed_url, now);
            if !matched.is_empty() {
                let names: Vec<&str> = matched.iter().map(|c| c.name.as_str()).collect();
                push_event(
                    &mut events,
                    started,
                    "info",
                    format!("Cookies attached: {}", names.join(", ")),
                );
            }
        }

        let mut builder = self.client.request(method, &url);

        // Attach request headers — validate eagerly so we surface a specific
        // error instead of reqwest's opaque "builder error".
        for h in &request.headers {
            if !h.enabled || h.name.trim().is_empty() {
                continue;
            }
            let name = reqwest::header::HeaderName::from_bytes(h.name.trim().as_bytes())
                .map_err(|_| VoleeoError::Http(format!("Invalid header name: \"{}\"", h.name)))?;
            let value = reqwest::header::HeaderValue::from_str(&h.value).map_err(|_| {
                VoleeoError::Http(format!(
                    "Invalid value for header \"{}\": header values must contain only printable ASCII characters",
                    h.name
                ))
            })?;
            builder = builder.header(name, value);
            push_event(
                &mut events,
                started,
                "send",
                format!("{}: {}", h.name.trim(), h.value),
            );
        }

        if let Some(body) = &request.body {
            builder =
                crate::body::attach_body(builder, body, &request.headers, &mut events, started)
                    .await?;
        }

        // Apply the dynamic-auth result computed above: notes → timeline, headers
        // → request. (Query params were already appended to the URL.)
        if let Some(signed) = dynamic_auth {
            for note in signed.notes {
                push_event(&mut events, started, "auth", note);
            }
            for (name, value) in signed.headers {
                let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| VoleeoError::Http(format!("Invalid auth header name: {name}")))?;
                let header_value =
                    reqwest::header::HeaderValue::from_str(&value).map_err(|_| {
                        VoleeoError::Http(format!("Invalid auth header value for {name}"))
                    })?;
                builder = builder.header(header_name, header_value);
                push_event(&mut events, started, "send", format!("{name}: {value}"));
            }
        }

        // Informational lookup so the timeline can show which IP we're hitting;
        // reqwest does its own resolution internally. Worst case we double-resolve
        // (cheap), best case the OS cache makes the second lookup free. If a
        // workspace DNS override matches `host`, surface it directly — that's
        // what reqwest's real resolver will use too.
        if !host.is_empty() && port > 0 {
            let host_lc = host.to_ascii_lowercase();
            let override_ip = DNS_OVERRIDES
                .try_with(|o| o.iter().find(|(h, _)| h == &host_lc).map(|(_, ip)| *ip))
                .unwrap_or(None);
            if let Some(ip) = override_ip {
                push_event(
                    &mut events,
                    started,
                    "dns",
                    format!("{host} → {ip} (workspace override)"),
                );
            } else {
                let dns_start = Instant::now();
                let lookup = tokio::net::lookup_host((host.as_str(), port)).await;
                let dns_ms = dns_start.elapsed().as_secs_f64() * 1000.0;
                if let Ok(addrs) = lookup {
                    let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
                    if !ips.is_empty() {
                        push_event(
                            &mut events,
                            started,
                            "dns",
                            format!("{host} → {} ({})", ips.join(", "), fmt_dur_ms(dns_ms)),
                        );
                    }
                }
            }
        }

        // Wording is hedged ("likely") because reqwest can still drop a pooled
        // connection transparently (server sent Connection:close, network blip).
        // POOL_IDLE_TIMEOUT matches reqwest's own setting so the tracker and the
        // pool agree on when a slot is stale.
        let pool_key = (host.clone(), port);
        let prior = self
            .last_seen
            .lock()
            .ok()
            .and_then(|m| m.get(&pool_key).copied());
        let reuse_text = match prior {
            Some(t) if t.elapsed() < POOL_IDLE_TIMEOUT => {
                format!(
                    "Connection likely reused (last request to {host}:{port} {} ago)",
                    fmt_age(t.elapsed())
                )
            }
            Some(_) => format!("New TCP connection (pool entry for {host}:{port} expired)"),
            None => format!("New TCP connection (first request to {host}:{port})"),
        };
        push_event(&mut events, started, "info", reuse_text);
        push_event(&mut events, started, "info", "Sending request to server");

        let response = match builder.send().await {
            Ok(r) => r,
            Err(e) => {
                drain_redirect_hops(&redirect_hops, &mut events);
                let msg = http_error_message(e);
                push_event(&mut events, started, "error", msg.clone());
                return Err(VoleeoError::HttpFailed(HttpFailure {
                    message: msg,
                    events,
                }));
            }
        };

        // Only update on success — a connect-timeout shouldn't refresh the
        // last-seen timestamp.
        if let Ok(mut map) = self.last_seen.lock() {
            map.insert(pool_key, Instant::now());
        }

        drain_redirect_hops(&redirect_hops, &mut events);

        let t_headers_ms = now_ms();

        let http_version = format!("{:?}", response.version());
        let status = response.status();
        let status_code = status.as_u16();
        let status_text = status.canonical_reason().unwrap_or("").to_string();

        push_event_at(
            &mut events,
            t_headers_ms,
            "recv",
            format!("{http_version} {status_code} {status_text}"),
        );

        // The DNS row may list several IPs; remote_addr() shows the one actually
        // used. Only `Some` once a connection was made.
        if let Some(addr) = response.remote_addr() {
            push_event_at(
                &mut events,
                t_headers_ms,
                "info",
                format!("Connected via {}", addr.ip()),
            );
        }

        // Per-header Instant::now() gives microsecond-scale variation from iteration
        // overhead, not true per-byte arrival timing (reqwest doesn't expose that).
        let mut headers: Vec<HttpResponseHeader> = Vec::new();
        for (k, v) in response.headers().iter() {
            let at_ms = now_ms();
            let value = v
                .to_str()
                .map(std::string::ToString::to_string)
                .unwrap_or_else(|_| String::new());
            let name = k.to_string();
            push_event_at(&mut events, at_ms, "recv", format!("{name}: {value}"));
            headers.push(HttpResponseHeader { name, value, at_ms });
        }

        // Cookies were already parsed into the capture sink by the reqwest
        // cookie provider (across every redirect hop). Surface each on the
        // timeline so the user can see what was stored, then drain into the
        // response so the command layer can persist them.
        let captured_cookies: Vec<StoredCookie> = capture_sink
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default();
        // Same idea for what we *sent* — the provider's `cookies()` pushed each
        // hop's matched list into `attached_sink`. Drain it so the Response >
        // Cookies tab can show the actual outgoing `Cookie:` payload.
        let attached_cookies: Vec<StoredCookie> = attached_sink
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default();
        for c in &captured_cookies {
            let ttl = match &c.expires {
                Some(e) => format!(" (expires={e})"),
                None => String::new(),
            };
            push_event(
                &mut events,
                started,
                "info",
                format!("Cookie captured: {}{ttl}", c.name),
            );
        }

        // Spec format: `metric;dur=100;desc="DB Query", other;dur=15`. Exploding
        // into rows lets the user attribute server-side latency from the timeline.
        if let Some(st) = response.headers().get("server-timing") {
            if let Ok(s) = st.to_str() {
                for entry in s.split(',') {
                    let segs: Vec<&str> = entry.split(';').map(str::trim).collect();
                    if segs.is_empty() || segs[0].is_empty() {
                        continue;
                    }
                    let name = segs[0];
                    let dur = segs
                        .iter()
                        .find_map(|p| p.strip_prefix("dur="))
                        .map(str::trim);
                    let desc = segs
                        .iter()
                        .find_map(|p| p.strip_prefix("desc="))
                        .map(|s| s.trim().trim_matches('"'));
                    let text = match (dur, desc) {
                        (Some(d), Some(de)) => format!("Server timing: {name} = {d} ms ({de})"),
                        (Some(d), None) => format!("Server timing: {name} = {d} ms"),
                        (None, Some(de)) => format!("Server timing: {name} ({de})"),
                        (None, None) => format!("Server timing: {name}"),
                    };
                    push_event(&mut events, started, "info", text);
                }
            }
        }

        let is_sse = headers.iter().any(|h| {
            h.name.eq_ignore_ascii_case("content-type")
                && h.value.to_ascii_lowercase().contains("text/event-stream")
        });
        // SSE streams have no natural EOF, so buffering the body would hang
        // forever. We parse frames as they land, leaving the stored body empty —
        // the frames are the content. A live sink (streaming send) is an optional
        // tap; without one (plain `send`, MCP) we still parse frames into a local
        // accumulator so the response carries `sse_frames` and terminates at the
        // frame cap instead of reading forever.
        let sse_sink = SSE_SINK.try_with(Clone::clone).ok().flatten();
        let mut stream = response.bytes_stream();

        let (body, body_size, body_is_text, no_sink_frames) = if is_sse {
            if let Some(sink) = sse_sink {
                // Hand the command the status/headers/timeline up front so a stream
                // cancelled mid-flight can still be rebuilt into a real response.
                sink(SseEvent::Open {
                    status: status_code,
                    status_text: status_text.clone(),
                    headers: headers.clone(),
                    events: events.clone(),
                    captured_cookies: captured_cookies.clone(),
                    attached_cookies: attached_cookies.clone(),
                });
                let mut decoder = SseDecoder::default();
                let mut seq: u32 = 0;
                while let Some(chunk) = stream.next().await {
                    let chunk = match chunk {
                        Ok(c) => c,
                        Err(e) => return Err(body_stream_err(&mut events, started, e)),
                    };
                    for raw in decoder.push(&chunk) {
                        push_sse_frame(&sink, &mut seq, started, raw);
                    }
                }
                for raw in decoder.finish() {
                    push_sse_frame(&sink, &mut seq, started, raw);
                }
                (String::new(), 0u32, true, None)
            } else {
                // No live sink (plain `send`, MCP): accumulate frames locally,
                // capped, so the response carries them and the read terminates
                // instead of looping on a stream that never EOFs. Cancellation and
                // timeout still abort via the outer `select!` in `send_scoped`.
                let mut decoder = SseDecoder::default();
                let mut frames: Vec<SseFrame> = Vec::new();
                let mut bytes: u32 = 0;
                let mut push = |frames: &mut Vec<SseFrame>, raw: RawFrame| {
                    bytes = bytes.saturating_add(raw.data.len() as u32);
                    frames.push(SseFrame {
                        seq: frames.len() as u32,
                        event: raw.event,
                        data: raw.data,
                        last_event_id: raw.id,
                        retry: raw.retry,
                        at_ms: started.elapsed().as_secs_f64() * 1000.0,
                    });
                };
                let mut capped = false;
                'read: while let Some(chunk) = stream.next().await {
                    let chunk = match chunk {
                        Ok(c) => c,
                        Err(e) => return Err(body_stream_err(&mut events, started, e)),
                    };
                    for raw in decoder.push(&chunk) {
                        push(&mut frames, raw);
                        if frames.len() >= SseAccum::FRAME_CAP {
                            capped = true;
                            break 'read;
                        }
                    }
                }
                if !capped {
                    for raw in decoder.finish() {
                        push(&mut frames, raw);
                    }
                } else {
                    push_event(
                        &mut events,
                        started,
                        "info",
                        format!(
                            "SSE frame cap reached ({}); stopped reading",
                            SseAccum::FRAME_CAP
                        ),
                    );
                }
                (String::new(), bytes, true, Some(frames))
            }
        } else {
            let mut body_bytes: Vec<u8> = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => return Err(body_stream_err(&mut events, started, e)),
                };
                push_event(
                    &mut events,
                    started,
                    "chunk",
                    format!("{} chunk received", fmt_bytes(chunk.len())),
                );
                body_bytes.extend_from_slice(&chunk);
            }
            let body_size = u32::try_from(body_bytes.len()).unwrap_or(u32::MAX);
            let (body, body_is_text) = if body_bytes.is_empty() {
                (String::new(), true)
            } else {
                match String::from_utf8(body_bytes.clone()) {
                    Ok(s) => (s, true),
                    Err(_) => {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&body_bytes);
                        (b64, false)
                    }
                }
            };
            (body, body_size, body_is_text, None)
        };

        let t_total_ms = now_ms();
        let download_ms = (t_total_ms - t_headers_ms).max(0.0);

        push_event_at(
            &mut events,
            t_total_ms,
            "done",
            if is_sse {
                format!("Stream ended in {}", fmt_dur_ms(download_ms))
            } else {
                format!(
                    "Connection complete · {} downloaded in {}",
                    fmt_bytes(body_size as usize),
                    fmt_dur_ms(download_ms),
                )
            },
        );

        let redirect_warning = compute_redirect_warning(request, &host, &redirect_hops);

        let response = HttpResponse {
            request_id,
            status: status_code,
            status_text,
            headers,
            body,
            body_size,
            body_is_text,
            // The store decides windowing + assigns response_id when persisting.
            body_windowed: false,
            body_line_count: 0,
            response_id: String::new(),
            timing: HttpTiming {
                dns_ms: 0.0,
                connect_ms: 0.0,
                tls_ms: 0.0,
                first_byte_ms: t_headers_ms,
                download_ms,
                total_ms: t_total_ms,
            },
            events,
            redirect_warning,
            captured_cookies,
            attached_cookies,
            // Streamed sends fill this via the command's `SseAccum`; the no-sink
            // SSE path sets it below. Empty for plain (non-SSE) bodies.
            sse_frames: no_sink_frames.unwrap_or_default(),
        };

        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_rejects_empty() {
        assert!(matches!(normalize_url(""), Err(VoleeoError::Http(_))));
        assert!(matches!(normalize_url("   "), Err(VoleeoError::Http(_))));
    }

    #[test]
    fn normalize_url_prepends_https_when_no_scheme() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
    }

    #[test]
    fn normalize_url_preserves_existing_scheme() {
        assert_eq!(
            normalize_url("http://example.com").unwrap(),
            "http://example.com"
        );
        assert_eq!(
            normalize_url("https://api.example.com/v1").unwrap(),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn normalize_url_trims_whitespace() {
        assert_eq!(normalize_url("  https://x.com  ").unwrap(), "https://x.com");
    }

    #[test]
    fn parse_method_accepts_valid_methods() {
        assert!(parse_method("GET").is_ok());
        assert!(parse_method("POST").is_ok());
        assert!(parse_method("DELETE").is_ok());
        assert!(parse_method("PATCH").is_ok());
    }

    #[test]
    fn parse_method_rejects_invalid() {
        assert!(parse_method("").is_err());
        assert!(parse_method("GET POST").is_err()); // spaces are not valid in method tokens
    }

    #[test]
    fn effective_method_forces_post_for_graphql_bodies() {
        let mut req = HttpRequest {
            id: "test-req".into(),
            request_type: "http".into(),
            model: "request".into(),
            workspace_id: "ws".into(),
            folder_id: None,
            method: "GET".into(),
            name: "Test".into(),
            url: "https://example.com".into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: voleeo_core::AuthConfig::None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        };
        assert_eq!(effective_method(&req).unwrap(), reqwest::Method::GET);

        req.body = Some(voleeo_core::RequestBody {
            kind: voleeo_core::BodyKind::Graphql,
            text: "{ me }".into(),
            ..Default::default()
        });
        assert_eq!(effective_method(&req).unwrap(), reqwest::Method::POST);
    }
}
