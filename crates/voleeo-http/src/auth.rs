//! Dynamic-auth application at the executor. Static schemes (Bearer/Basic/API
//! key) are turned into headers by the resolve layer before they ever reach
//! here; dynamic schemes need the *final* request (method, URL, body) and so are
//! applied at send time, after the body is assembled. Phase 1: AWS SigV4.

use voleeo_auth::sigv4::{self, SigV4Request};
use voleeo_auth::{digest, oauth1};
use voleeo_core::{
    AuthConfig, HttpRequest, OAuth1Location, OAuth1Signature, RequestBody, VoleeoError,
};

/// The request-target (path + query) a Digest response must hash over — matches
/// what the executor puts on the wire.
fn request_target(url: &reqwest::Url) -> String {
    match url.query() {
        Some(q) if !q.is_empty() => format!("{}?{q}", url.path()),
        _ => url.path().to_string(),
    }
}

/// Bytes the executor will send as the body — needed for Digest `qop=auth-int`.
/// Non-reproducible bodies (multipart/binary) hash as empty; servers offering
/// `auth` (preferred by the parser) never reach this.
fn digest_body(body: Option<&RequestBody>) -> Vec<u8> {
    body.and_then(crate::body::reproducible_body_bytes)
        .unwrap_or_default()
}

/// Compute the `Authorization: Digest` header answering a `401` challenge, with a
/// timeline note. `None` when the scheme isn't an active Digest or no usable
/// challenge was offered.
pub fn digest_authorization(
    auth: &AuthConfig,
    request: &HttpRequest,
    www_authenticate: &[&str],
) -> Option<(String, String)> {
    if !auth.is_active() {
        return None;
    }
    let AuthConfig::Digest {
        username, password, ..
    } = auth
    else {
        return None;
    };
    let challenge = digest::pick_challenge(www_authenticate.iter().copied())?;
    let normalized = crate::executor::normalize_url(&request.url).ok()?;
    let parsed = reqwest::Url::parse(&normalized).ok()?;
    let method = crate::executor::effective_method(request).ok()?;
    let body = digest_body(request.body.as_ref());
    let header = digest::authorization(
        &challenge,
        &digest::Request {
            username,
            password,
            method: method.as_str(),
            uri: &request_target(&parsed),
            body: &body,
        },
        &digest::gen_cnonce(),
        1,
    );
    let note = format!(
        "Digest challenge — realm \"{}\", {} — retrying with credentials",
        challenge.realm,
        challenge.algorithm.label(),
    );
    Some((header, note))
}

/// Compute the SHA-256 the signer needs over the body bytes reqwest will send.
/// Multipart/binary aren't cheaply reproducible (boundaries, large files) → sign
/// as `UNSIGNED-PAYLOAD`, which AWS accepts. Returns `(hash, reproduced)` where
/// `reproduced == false` drove the unsigned path (for a timeline note).
fn payload_sha256(body: Option<&RequestBody>) -> (String, bool) {
    // No body hashes the same as an empty one; `BodyKind::None` reproduces as
    // `Some([])`, so only multipart/binary (the helper's `None`) go unsigned.
    let Some(body) = body else {
        return (sigv4::empty_payload_hash(), true);
    };
    match crate::body::reproducible_body_bytes(body) {
        Some(bytes) => (sigv4::payload_hash(&bytes), true),
        None => ("UNSIGNED-PAYLOAD".to_string(), false),
    }
}

/// Signed headers and/or query params for a dynamic scheme, plus human-readable
/// timeline notes. The executor surfaces the notes as `auth` events.
pub struct DynamicAuth {
    pub headers: Vec<(String, String)>,
    pub query: Vec<(String, String)>,
    pub notes: Vec<String>,
}

impl DynamicAuth {
    fn empty() -> Self {
        DynamicAuth {
            headers: Vec::new(),
            query: Vec::new(),
            notes: Vec::new(),
        }
    }
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
        return Ok(DynamicAuth::empty());
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
                query: Vec::new(),
                notes,
            })
        }
        AuthConfig::OAuth1 {
            consumer_key,
            consumer_secret,
            token,
            token_secret,
            signature_method,
            realm,
            private_key,
            params_location,
            callback,
            verifier,
            timestamp,
            nonce,
            version,
            ..
        } => {
            if consumer_key.trim().is_empty() {
                return Err(VoleeoError::Http(
                    "OAuth 1.0 requires a consumer key".into(),
                ));
            }
            // base string URL: scheme://host[:port]/path, no query.
            let base_url = format!(
                "{}://{}{}",
                parsed_url.scheme(),
                host_header(parsed_url),
                parsed_url.path(),
            );
            let method_sig = match signature_method {
                OAuth1Signature::HmacSha1 => oauth1::SignatureMethod::HmacSha1,
                OAuth1Signature::HmacSha256 => oauth1::SignatureMethod::HmacSha256,
                OAuth1Signature::HmacSha512 => oauth1::SignatureMethod::HmacSha512,
                OAuth1Signature::RsaSha1 => oauth1::SignatureMethod::RsaSha1,
                OAuth1Signature::RsaSha256 => oauth1::SignatureMethod::RsaSha256,
                OAuth1Signature::RsaSha512 => oauth1::SignatureMethod::RsaSha512,
                OAuth1Signature::PlainText => oauth1::SignatureMethod::PlainText,
            };
            let nonce = if nonce.trim().is_empty() {
                oauth1::gen_nonce()
            } else {
                nonce.trim().to_string()
            };
            let signed = oauth1::sign(
                &oauth1::OAuth1Request {
                    method,
                    base_url: &base_url,
                    query: parsed_url.query().unwrap_or(""),
                    consumer_key: consumer_key.trim(),
                    consumer_secret,
                    token: token.trim(),
                    token_secret,
                    signature_method: method_sig,
                    realm: realm.trim(),
                    private_key,
                    callback: callback.trim(),
                    verifier: verifier.trim(),
                    timestamp: timestamp.trim(),
                    version: version.trim(),
                },
                &nonce,
                chrono::Utc::now(),
            )
            .map_err(VoleeoError::Http)?;
            let note = format!(
                "OAuth 1.0 {} — consumer key {} ({})",
                signed.method_label,
                consumer_key.trim(),
                match params_location {
                    OAuth1Location::Header => "header",
                    OAuth1Location::Query => "query",
                },
            );
            let (headers, query) = match params_location {
                OAuth1Location::Header => (vec![signed.header], Vec::new()),
                OAuth1Location::Query => (Vec::new(), signed.params),
            };
            Ok(DynamicAuth {
                headers,
                query,
                notes: vec![note],
            })
        }
        // Static schemes resolve to headers upstream; nothing to do here.
        _ => Ok(DynamicAuth::empty()),
    }
}

/// String-URL variant for callers without a parsed `reqwest::Url` (the
/// preview/copy-as command). Returns `(headers, query)`. Normalizes the URL the
/// same way a send does.
#[allow(clippy::type_complexity)]
pub fn sign_dynamic_auth_url(
    auth: &AuthConfig,
    method: &str,
    url: &str,
    body: Option<&RequestBody>,
) -> Result<(Vec<(String, String)>, Vec<(String, String)>), VoleeoError> {
    let normalized = crate::executor::normalize_url(url)?;
    let parsed = reqwest::Url::parse(&normalized)
        .map_err(|e| VoleeoError::Http(format!("Invalid URL: {e}")))?;
    let result = sign_dynamic_auth(auth, method, &parsed, body)?;
    Ok((result.headers, result.query))
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
    use voleeo_core::{BodyField, BodyKind};

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
