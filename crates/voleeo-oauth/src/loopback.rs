//! One-shot loopback HTTP server for the OAuth 2.0 authorization-code redirect.
//! Binds `127.0.0.1:<random>`, hands back the redirect URI, then awaits the
//! browser redirect, verifies `state`, and returns the `code`.

use std::collections::HashMap;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use voleeo_auth::encode::percent_decode;
use voleeo_core::VoleeoError;

use crate::flow::TokenResult;

/// Page served on the first implicit-redirect hit: the access token lives in the
/// URL fragment (never sent to us), so this relays `location.hash` back as a query.
const RELAY_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>\
<script>var h=location.hash.slice(1);if(h){location.replace('/callback?'+h)}\
else{document.body.textContent='No token in redirect'}</script></body></html>";

pub struct Loopback {
    listener: TcpListener,
    pub port: u16,
}

enum Outcome {
    Code(String),
    Error(String),
    /// Not the callback (e.g. `/favicon.ico`) — keep waiting.
    Ignore,
}

impl Loopback {
    pub async fn bind() -> Result<Self, VoleeoError> {
        Self::bind_port(0).await
    }

    /// Bind a specific loopback port (0 = OS-assigned). Used when the user pins a
    /// fixed redirect URI the provider has registered.
    pub async fn bind_port(port: u16) -> Result<Self, VoleeoError> {
        let listener = TcpListener::bind(("127.0.0.1", port))
            .await
            .map_err(|e| VoleeoError::Http(format!("loopback bind failed: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| VoleeoError::Http(e.to_string()))?
            .port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Await the redirect, verify `state`, and return the `code`. Browser
    /// pre-flights (`/favicon.ico`) are answered and ignored.
    pub async fn wait_for_code(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<String, VoleeoError> {
        let state = expected_state.to_string();
        self.serve(timeout, move |path| match parse_callback(path, &state) {
            Outcome::Code(c) => Served::done(complete_page(), Ok(c)),
            Outcome::Error(m) => Served::done(failed_page(&m), Err(auth_failed(&m))),
            Outcome::Ignore => Served::Continue("ok".to_string()),
        })
        .await
    }

    /// Implicit-flow variant: the token arrives in the URL fragment, so the first
    /// hit serves `RELAY_PAGE` (which bounces the fragment back as a query) and the
    /// second hit carries the token.
    pub async fn wait_for_token(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<TokenResult, VoleeoError> {
        let state = expected_state.to_string();
        self.serve(timeout, move |path| match parse_token(path, &state) {
            TokenOutcome::Token(t) => Served::done(complete_page(), Ok(*t)),
            TokenOutcome::Error(m) => Served::done(failed_page(&m), Err(auth_failed(&m))),
            TokenOutcome::Relay => Served::Continue(RELAY_PAGE.to_string()),
            TokenOutcome::Ignore => Served::Continue("ok".to_string()),
        })
        .await
    }

    /// One-shot HTTP loop: answer each request with the page `handle` returns and,
    /// once it returns `Done`, stop and yield its result. Bounded by `timeout`.
    async fn serve<T>(
        self,
        timeout: Duration,
        handle: impl Fn(&str) -> Served<T>,
    ) -> Result<T, VoleeoError> {
        let accept = async {
            loop {
                let (mut stream, _) = self
                    .listener
                    .accept()
                    .await
                    .map_err(|e| VoleeoError::Http(e.to_string()))?;
                let mut data = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    data.extend_from_slice(&buf[..n]);
                    if data.contains(&b'\n') || data.len() > 16 * 1024 {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&data);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("");

                let (body, result) = match handle(path) {
                    Served::Done { body, result } => (body, Some(result)),
                    Served::Continue(body) => (body, None),
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.flush().await;
                if let Some(r) = result {
                    return r;
                }
            }
        };
        match tokio::time::timeout(timeout, accept).await {
            Ok(r) => r,
            Err(_) => Err(VoleeoError::Http("OAuth2 authorization timed out".into())),
        }
    }
}

/// `serve`'s per-request decision: keep waiting (serve `body`) or finish (serve
/// `body`, then return `result`).
enum Served<T> {
    Done {
        body: String,
        result: Result<T, VoleeoError>,
    },
    Continue(String),
}

impl<T> Served<T> {
    fn done(body: String, result: Result<T, VoleeoError>) -> Self {
        Served::Done { body, result }
    }
}

fn complete_page() -> String {
    page(
        "Authorization complete",
        "You can close this tab and return to Voleeo.",
    )
}
fn failed_page(msg: &str) -> String {
    page("Authorization failed", msg)
}
fn auth_failed(msg: &str) -> VoleeoError {
    VoleeoError::Http(format!("OAuth2 authorization failed: {msg}"))
}

enum TokenOutcome {
    Token(Box<TokenResult>),
    Error(String),
    /// First hit (no query yet) — serve the fragment-relay page.
    Relay,
    Ignore,
}

/// CSRF check: the redirect's `state` must echo the one we generated. Present on
/// both success and error responses (RFC 6749 §4.1.2/§4.2.2), so verify it before
/// acting on either.
fn state_ok(params: &HashMap<String, String>, expected_state: &str) -> bool {
    params.get("state").map(String::as_str) == Some(expected_state)
}

fn parse_token(path: &str, expected_state: &str) -> TokenOutcome {
    if !path.starts_with("/callback") {
        return TokenOutcome::Ignore;
    }
    let Some(qpos) = path.find('?') else {
        return TokenOutcome::Relay;
    };
    let params: HashMap<String, String> = path[qpos + 1..]
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect();

    if let Some(err) = params.get("error") {
        if !state_ok(&params, expected_state) {
            return TokenOutcome::Error("state mismatch (possible CSRF)".into());
        }
        let detail = params
            .get("error_description")
            .map(|d| format!(" — {d}"))
            .unwrap_or_default();
        return TokenOutcome::Error(format!("{err}{detail}"));
    }
    let Some(token) = params.get("access_token").filter(|t| !t.is_empty()) else {
        return TokenOutcome::Relay;
    };
    if !state_ok(&params, expected_state) {
        return TokenOutcome::Error("state mismatch (possible CSRF)".into());
    }
    let expires_at = params
        .get("expires_in")
        .and_then(|s| s.parse::<i64>().ok())
        .map(|s| chrono::Utc::now().timestamp() + s - 30)
        .unwrap_or(0);
    TokenOutcome::Token(Box::new(TokenResult {
        access_token: token.clone(),
        refresh_token: String::new(),
        token_type: params
            .get("token_type")
            .cloned()
            .unwrap_or_else(|| "Bearer".into()),
        scope: params.get("scope").cloned().unwrap_or_default(),
        expires_at,
    }))
}

fn parse_callback(path: &str, expected_state: &str) -> Outcome {
    if !path.starts_with("/callback") {
        return Outcome::Ignore;
    }
    let Some(qpos) = path.find('?') else {
        return Outcome::Error("missing authorization code".into());
    };
    let params: HashMap<String, String> = path[qpos + 1..]
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect();

    if !state_ok(&params, expected_state) {
        return Outcome::Error("state mismatch (possible CSRF)".into());
    }
    if let Some(err) = params.get("error") {
        let detail = params
            .get("error_description")
            .map(|d| format!(" — {d}"))
            .unwrap_or_default();
        return Outcome::Error(format!("{err}{detail}"));
    }
    match params.get("code") {
        Some(code) if !code.is_empty() => Outcome::Code(code.clone()),
        _ => Outcome::Error("missing authorization code".into()),
    }
}

/// Escape HTML metacharacters — `message` can carry a provider-controlled
/// `error_description`, so interpolating it raw would allow markup injection.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn page(title: &str, message: &str) -> String {
    let (title, message) = (esc(title), esc(message));
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
         <body style=\"font-family:system-ui;background:#0b0b0d;color:#d7d8db;display:flex;\
         align-items:center;justify-content:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h2>{title}</h2><p style=\"color:#8a8f98\">{message}</p></div>\
         </body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_with_matching_state() {
        match parse_callback("/callback?code=abc123&state=xyz", "xyz") {
            Outcome::Code(c) => assert_eq!(c, "abc123"),
            _ => panic!("expected code"),
        }
    }

    #[test]
    fn rejects_state_mismatch() {
        assert!(matches!(
            parse_callback("/callback?code=abc&state=bad", "xyz"),
            Outcome::Error(_)
        ));
    }

    #[test]
    fn surfaces_provider_error() {
        assert!(matches!(
            parse_callback("/callback?error=access_denied&state=xyz", "xyz"),
            Outcome::Error(_)
        ));
    }

    #[test]
    fn provider_error_with_forged_state_is_csrf() {
        // State is verified before the provider error is surfaced.
        match parse_callback("/callback?error=access_denied&state=bad", "xyz") {
            Outcome::Error(m) => assert!(m.contains("state mismatch")),
            _ => panic!("expected state-mismatch error"),
        }
    }

    #[test]
    fn ignores_non_callback_paths() {
        assert!(matches!(
            parse_callback("/favicon.ico", "xyz"),
            Outcome::Ignore
        ));
    }

    #[test]
    fn implicit_relays_then_parses_token() {
        // First hit (no query) → relay the fragment back.
        assert!(matches!(
            parse_token("/callback", "xyz"),
            TokenOutcome::Relay
        ));
        // Relayed query carries the token.
        match parse_token(
            "/callback?access_token=tok&state=xyz&expires_in=3600",
            "xyz",
        ) {
            TokenOutcome::Token(t) => {
                assert_eq!(t.access_token, "tok");
                assert!(t.expires_at > 0);
            }
            _ => panic!("expected token"),
        }
        assert!(matches!(
            parse_token("/callback?access_token=tok&state=bad", "xyz"),
            TokenOutcome::Error(_)
        ));
    }
}
