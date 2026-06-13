//! One-shot loopback HTTP server for the OAuth 2.0 authorization-code redirect.
//! Binds `127.0.0.1:<random>`, hands back the redirect URI, then awaits the
//! browser redirect, verifies `state`, and returns the `code`.

use std::collections::HashMap;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use voleeo_auth::encode::percent_decode;
use voleeo_core::VoleeoError;

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
        let listener = TcpListener::bind("127.0.0.1:0")
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
        let accept = async {
            loop {
                let (mut stream, _) = self
                    .listener
                    .accept()
                    .await
                    .map_err(|e| VoleeoError::Http(e.to_string()))?;
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("");

                let outcome = parse_callback(path, expected_state);
                let (page, done) = match &outcome {
                    Outcome::Code(_) => (
                        page(
                            "Authorization complete",
                            "You can close this tab and return to Voleeo.",
                        ),
                        true,
                    ),
                    Outcome::Error(msg) => (page("Authorization failed", msg), true),
                    Outcome::Ignore => (String::new(), false),
                };
                let body = if done { page } else { "ok".to_string() };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.flush().await;

                match outcome {
                    Outcome::Code(code) => return Ok(code),
                    Outcome::Error(msg) => {
                        return Err(VoleeoError::Http(format!(
                            "OAuth2 authorization failed: {msg}"
                        )))
                    }
                    Outcome::Ignore => continue,
                }
            }
        };
        match tokio::time::timeout(timeout, accept).await {
            Ok(r) => r,
            Err(_) => Err(VoleeoError::Http("OAuth2 authorization timed out".into())),
        }
    }
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

    if let Some(err) = params.get("error") {
        let detail = params
            .get("error_description")
            .map(|d| format!(" — {d}"))
            .unwrap_or_default();
        return Outcome::Error(format!("{err}{detail}"));
    }
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Outcome::Error("state mismatch (possible CSRF)".into());
    }
    match params.get("code") {
        Some(code) if !code.is_empty() => Outcome::Code(code.clone()),
        _ => Outcome::Error("missing authorization code".into()),
    }
}

fn page(title: &str, message: &str) -> String {
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
    fn ignores_non_callback_paths() {
        assert!(matches!(
            parse_callback("/favicon.ico", "xyz"),
            Outcome::Ignore
        ));
    }
}
