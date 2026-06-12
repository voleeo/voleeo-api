use crate::fmt::{fmt_age, fmt_bytes, fmt_dur_ms, http_error_message, push_event, push_event_at};
use crate::redirect::{compute_redirect_warning, drain_redirect_hops, RedirectHop};
use crate::{HttpExecutor, DNS_OVERRIDES, MAX_REDIRECTS, POOL_IDLE_TIMEOUT};
use base64::Engine;
use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use voleeo_core::{
    HttpFailure, HttpRequest, HttpResponse, HttpResponseHeader, HttpTiming, StoredCookie,
    VoleeoError,
};

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
        let url = normalize_url(&request.url)?;
        let method = effective_method(request)?;

        let parsed_url = reqwest::Url::parse(&url)
            .map_err(|e| VoleeoError::Http(format!("Invalid URL: {e}")))?;
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

        let mut body_bytes: Vec<u8> = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    let msg = format!("Body stream failed: {e}");
                    push_event(&mut events, started, "error", msg.clone());
                    return Err(VoleeoError::HttpFailed(HttpFailure {
                        message: msg,
                        events,
                    }));
                }
            };
            push_event(
                &mut events,
                started,
                "chunk",
                format!("{} chunk received", fmt_bytes(chunk.len())),
            );
            body_bytes.extend_from_slice(&chunk);
        }

        let t_total_ms = now_ms();
        let download_ms = (t_total_ms - t_headers_ms).max(0.0);

        push_event_at(
            &mut events,
            t_total_ms,
            "done",
            format!(
                "Connection complete · {} downloaded in {}",
                fmt_bytes(body_bytes.len()),
                fmt_dur_ms(download_ms),
            ),
        );

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

        let redirect_warning = compute_redirect_warning(request, &host, &redirect_hops);

        Ok(HttpResponse {
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
        })
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
