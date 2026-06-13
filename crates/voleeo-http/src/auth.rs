//! Dynamic-auth application at the executor. Static schemes (Bearer/Basic/API
//! key) are turned into headers by the resolve layer before they ever reach
//! here; dynamic schemes need the *final* request (method, URL, body) and so are
//! applied at send time, after the body is assembled. Phase 1: AWS SigV4.

use crate::fmt::push_event;
use std::time::Instant;
use voleeo_auth::sigv4::{self, SigV4Request};
use voleeo_core::{AuthConfig, BodyKind, RequestBody, TimelineEvent, VoleeoError};

/// Compute the SHA-256 the signer needs over the body bytes reqwest will send.
/// Multipart/binary aren't cheaply reproducible (boundaries, large files) → sign
/// as `UNSIGNED-PAYLOAD`, which AWS accepts. Returns `(hash, reproduced)` where
/// `reproduced == false` drove the unsigned path (for a timeline note).
fn payload_sha256(body: Option<&RequestBody>) -> (String, bool) {
    let Some(body) = body else {
        return (sigv4::empty_payload_hash(), true);
    };
    match body.kind {
        BodyKind::None => (sigv4::empty_payload_hash(), true),
        BodyKind::Json | BodyKind::Xml | BodyKind::Text | BodyKind::Html => {
            (sigv4::payload_hash(body.text.as_bytes()), true)
        }
        BodyKind::Graphql => (sigv4::payload_hash(body.graphql_payload().as_bytes()), true),
        BodyKind::FormUrlEncoded => {
            // Must byte-match reqwest's `.form()` — it serializes with
            // serde_urlencoded, so we do too.
            let pairs: Vec<(&str, &str)> = body
                .fields
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .filter(|f| f.enabled && !f.name.trim().is_empty())
                .map(|f| (f.name.as_str(), f.value.as_str()))
                .collect();
            let encoded = serde_urlencoded::to_string(&pairs).unwrap_or_default();
            (sigv4::payload_hash(encoded.as_bytes()), true)
        }
        BodyKind::Multipart | BodyKind::Binary => ("UNSIGNED-PAYLOAD".to_string(), false),
    }
}

/// Signed headers for a dynamic scheme plus human-readable timeline notes. The
/// executor surfaces the notes as `auth` events; preview/copy-as use just the
/// headers.
pub struct DynamicAuth {
    pub headers: Vec<(String, String)>,
    pub notes: Vec<String>,
}

/// Sign a dynamic scheme (AWS SigV4) over the final request. Pure — no side
/// effects — so the executor (send), the preview, and copy-as all share one
/// signer. Empty result for `None`/static schemes (handled upstream).
pub fn sign_dynamic_auth(
    auth: &AuthConfig,
    method: &str,
    parsed_url: &reqwest::Url,
    body: Option<&RequestBody>,
) -> Result<DynamicAuth, VoleeoError> {
    // A disabled (toggled-off) scheme contributes nothing — the single home for
    // dynamic-auth gating, so every caller (send/preview/copy-as) agrees.
    if !auth.is_active() {
        return Ok(DynamicAuth {
            headers: Vec::new(),
            notes: Vec::new(),
        });
    }
    match auth {
        AuthConfig::AwsSigV4 {
            access_key,
            secret_key,
            session_token,
            region,
            service,
            ..
        } => {
            if access_key.trim().is_empty() || secret_key.trim().is_empty() {
                return Err(VoleeoError::Http(
                    "AWS SigV4 requires an access key and secret key".into(),
                ));
            }
            let host = host_header(parsed_url);
            let (payload, reproduced) = payload_sha256(body);
            let mut notes = Vec::new();
            if !reproduced {
                notes.push(
                    "AWS SigV4 — body not reproducible, signing as UNSIGNED-PAYLOAD".to_string(),
                );
            }
            let token = session_token.trim();
            let signed = sigv4::sign(
                &SigV4Request {
                    method,
                    host: &host,
                    path: parsed_url.path(),
                    query: parsed_url.query().unwrap_or(""),
                    payload_sha256: &payload,
                    access_key: access_key.trim(),
                    secret_key,
                    session_token: (!token.is_empty()).then_some(token),
                    region: region.trim(),
                    service: service.trim(),
                },
                chrono::Utc::now(),
            );
            notes.push(format!(
                "AWS SigV4 — scope {}, signed headers {}",
                signed.credential_scope, signed.signed_headers
            ));
            Ok(DynamicAuth {
                headers: signed.headers,
                notes,
            })
        }
        // Static schemes resolve to headers upstream; nothing to do here.
        _ => Ok(DynamicAuth {
            headers: Vec::new(),
            notes: Vec::new(),
        }),
    }
}

/// String-URL variant for callers without a parsed `reqwest::Url` (the
/// preview/copy-as command). Normalizes the URL the same way a send does.
pub fn sign_dynamic_auth_url(
    auth: &AuthConfig,
    method: &str,
    url: &str,
    body: Option<&RequestBody>,
) -> Result<Vec<(String, String)>, VoleeoError> {
    let normalized = crate::executor::normalize_url(url)?;
    let parsed = reqwest::Url::parse(&normalized)
        .map_err(|e| VoleeoError::Http(format!("Invalid URL: {e}")))?;
    Ok(sign_dynamic_auth(auth, method, &parsed, body)?.headers)
}

/// Executor path: sign and push the timeline notes as `auth` events.
pub(crate) fn dynamic_auth_headers(
    auth: &AuthConfig,
    method: &str,
    parsed_url: &reqwest::Url,
    body: Option<&RequestBody>,
    events: &mut Vec<TimelineEvent>,
    started: Instant,
) -> Result<Vec<(String, String)>, VoleeoError> {
    let result = sign_dynamic_auth(auth, method, parsed_url, body)?;
    for note in result.notes {
        push_event(events, started, "auth", note);
    }
    Ok(result.headers)
}

/// The `Host` header value reqwest will send: host plus `:port` only when the
/// port is non-default for the scheme (matches what SigV4 must canonicalize).
fn host_header(url: &reqwest::Url) -> String {
    let host = url.host_str().unwrap_or("");
    match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::BodyField;

    #[test]
    fn host_header_omits_default_port() {
        let u = reqwest::Url::parse("https://api.example.com/path").unwrap();
        assert_eq!(host_header(&u), "api.example.com");
    }

    #[test]
    fn host_header_includes_custom_port() {
        let u = reqwest::Url::parse("https://api.example.com:8443/path").unwrap();
        assert_eq!(host_header(&u), "api.example.com:8443");
    }

    #[test]
    fn empty_and_text_payload_hashes() {
        assert_eq!(payload_sha256(None).0, sigv4::empty_payload_hash());
        let body = RequestBody {
            kind: BodyKind::Json,
            text: "{\"a\":1}".into(),
            ..Default::default()
        };
        assert_eq!(
            payload_sha256(Some(&body)).0,
            sigv4::payload_hash(b"{\"a\":1}")
        );
    }

    #[test]
    fn disabled_dynamic_auth_signs_nothing() {
        let url = reqwest::Url::parse("https://example.com/").unwrap();
        let auth = AuthConfig::AwsSigV4 {
            access_key: "AKIA".into(),
            secret_key: "secret".into(),
            secret_key_encrypted: false,
            session_token: String::new(),
            session_token_encrypted: false,
            region: "us-east-1".into(),
            service: "execute-api".into(),
            enabled: false,
        };
        let out = sign_dynamic_auth(&auth, "GET", &url, None).unwrap();
        assert!(out.headers.is_empty(), "disabled auth must not sign");
        assert!(out.notes.is_empty());
    }

    #[test]
    fn multipart_is_unsigned() {
        let body = RequestBody {
            kind: BodyKind::Multipart,
            fields: Some(vec![BodyField {
                id: "1".into(),
                name: "f".into(),
                value: "/tmp/x".into(),
                enabled: true,
                is_file: true,
                content_type: None,
            }]),
            ..Default::default()
        };
        let (hash, reproduced) = payload_sha256(Some(&body));
        assert_eq!(hash, "UNSIGNED-PAYLOAD");
        assert!(!reproduced);
    }
}
