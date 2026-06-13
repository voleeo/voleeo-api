//! OAuth 1.0 request signing (RFC 5849), `Authorization`-header flavor.
//!
//! Pipeline: collect the protocol + query params → normalize → signature base
//! string → HMAC (or PLAINTEXT) → `Authorization: OAuth …` header. Two-legged
//! (consumer-only) flows leave `token`/`token_secret` empty.

use base64::Engine;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs1v15::SigningKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::signature::{SignatureEncoding, Signer};
use rsa::RsaPrivateKey;
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use crate::encode::{hex_lower, percent_decode, uri_encode};

/// Signature algorithm. `Hmac*` use the secrets, `Rsa*` the private key,
/// `PlainText` skips hashing (TLS-only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureMethod {
    HmacSha1,
    HmacSha256,
    HmacSha512,
    RsaSha1,
    RsaSha256,
    RsaSha512,
    PlainText,
}

impl SignatureMethod {
    fn label(self) -> &'static str {
        match self {
            SignatureMethod::HmacSha1 => "HMAC-SHA1",
            SignatureMethod::HmacSha256 => "HMAC-SHA256",
            SignatureMethod::HmacSha512 => "HMAC-SHA512",
            SignatureMethod::RsaSha1 => "RSA-SHA1",
            SignatureMethod::RsaSha256 => "RSA-SHA256",
            SignatureMethod::RsaSha512 => "RSA-SHA512",
            SignatureMethod::PlainText => "PLAINTEXT",
        }
    }

    fn is_rsa(self) -> bool {
        matches!(
            self,
            SignatureMethod::RsaSha1 | SignatureMethod::RsaSha256 | SignatureMethod::RsaSha512
        )
    }
}

/// The final request decomposed into what OAuth 1.0 signs. `base_url` is
/// scheme://host[:non-default-port]/path with no query; `query` is the raw
/// query string (its params join the signature base).
pub struct OAuth1Request<'a> {
    pub method: &'a str,
    pub base_url: &'a str,
    pub query: &'a str,
    pub consumer_key: &'a str,
    pub consumer_secret: &'a str,
    /// Empty = two-legged (no access token).
    pub token: &'a str,
    pub token_secret: &'a str,
    pub signature_method: SignatureMethod,
    /// Empty = omit the `realm` parameter.
    pub realm: &'a str,
    /// PEM-encoded RSA private key — required by the `Rsa*` methods.
    pub private_key: &'a str,
    /// Advanced overrides; empty = use the default / omit the param.
    pub callback: &'a str,
    pub verifier: &'a str,
    pub timestamp: &'a str,
    pub version: &'a str,
}

pub struct SignedOAuth1 {
    /// `("Authorization", "OAuth …")` — for header placement.
    pub header: (String, String),
    /// Raw `oauth_*` params incl. the signature — for query/body placement.
    pub params: Vec<(String, String)>,
    pub method_label: &'static str,
}

/// 16 random bytes, hex — a fresh `oauth_nonce` per request.
pub fn gen_nonce() -> String {
    let bytes: [u8; 16] = rand::random();
    hex_lower(&bytes)
}

pub fn sign(req: &OAuth1Request, nonce: &str, now: DateTime<Utc>) -> Result<SignedOAuth1, String> {
    let timestamp = if req.timestamp.is_empty() {
        now.timestamp().to_string()
    } else {
        req.timestamp.to_string()
    };
    let version = if req.version.is_empty() {
        "1.0"
    } else {
        req.version
    };
    let method_label = req.signature_method.label();

    // Protocol params that join the signature base (oauth_signature excluded).
    let mut oauth: Vec<(String, String)> = vec![
        ("oauth_consumer_key".into(), req.consumer_key.to_string()),
        ("oauth_nonce".into(), nonce.to_string()),
        ("oauth_signature_method".into(), method_label.to_string()),
        ("oauth_timestamp".into(), timestamp),
        ("oauth_version".into(), version.to_string()),
    ];
    if !req.token.is_empty() {
        oauth.push(("oauth_token".into(), req.token.to_string()));
    }
    if !req.callback.is_empty() {
        oauth.push(("oauth_callback".into(), req.callback.to_string()));
    }
    if !req.verifier.is_empty() {
        oauth.push(("oauth_verifier".into(), req.verifier.to_string()));
    }

    // Base-string params: query + oauth, each %-encoded, sorted, `k=v` joined.
    let mut params: Vec<(String, String)> = req
        .query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (
                uri_encode(&percent_decode(k)),
                uri_encode(&percent_decode(v)),
            )
        })
        .collect();
    params.extend(oauth.iter().map(|(k, v)| (uri_encode(k), uri_encode(v))));
    params.sort();
    let normalized = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");

    let base_string = format!(
        "{}&{}&{}",
        req.method,
        uri_encode(req.base_url),
        uri_encode(&normalized),
    );

    // HMAC/PLAINTEXT signing key is `consumer_secret&token_secret` (each
    // %-encoded); RSA ignores it and signs with the private key instead.
    let signing_key = format!(
        "{}&{}",
        uri_encode(req.consumer_secret),
        uri_encode(req.token_secret),
    );
    if req.signature_method.is_rsa() && req.private_key.trim().is_empty() {
        return Err("RSA signature method requires a private key".into());
    }
    let signature = match req.signature_method {
        SignatureMethod::HmacSha1 => {
            base64_std(&hmac_sha1(signing_key.as_bytes(), base_string.as_bytes()))
        }
        SignatureMethod::HmacSha256 => {
            base64_std(&hmac_sha256(signing_key.as_bytes(), base_string.as_bytes()))
        }
        SignatureMethod::HmacSha512 => {
            base64_std(&hmac_sha512(signing_key.as_bytes(), base_string.as_bytes()))
        }
        SignatureMethod::RsaSha1 => {
            base64_std(&rsa_sign_sha1(req.private_key, base_string.as_bytes())?)
        }
        SignatureMethod::RsaSha256 => {
            base64_std(&rsa_sign_sha256(req.private_key, base_string.as_bytes())?)
        }
        SignatureMethod::RsaSha512 => {
            base64_std(&rsa_sign_sha512(req.private_key, base_string.as_bytes())?)
        }
        SignatureMethod::PlainText => signing_key.clone(),
    };

    // The signed params (oauth_* + signature) — used directly for query/body
    // placement, and quoted into the header for header placement.
    let mut params = oauth;
    params.push(("oauth_signature".into(), signature));

    let mut header_pairs: Vec<(String, String)> = Vec::new();
    if !req.realm.is_empty() {
        header_pairs.push(("realm".into(), req.realm.to_string()));
    }
    header_pairs.extend(params.iter().cloned());
    let header_value = format!(
        "OAuth {}",
        header_pairs
            .iter()
            .map(|(k, v)| format!("{}=\"{}\"", k, uri_encode(v)))
            .collect::<Vec<_>>()
            .join(", ")
    );

    Ok(SignedOAuth1 {
        header: ("Authorization".to_string(), header_value),
        params,
        method_label,
    })
}

fn hmac_sha1(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hmac_sha512(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha512>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Parse a PEM RSA private key (PKCS#8 or PKCS#1).
fn parse_rsa_key(pem: &str) -> Result<RsaPrivateKey, String> {
    RsaPrivateKey::from_pkcs8_pem(pem)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(pem))
        .map_err(|e| format!("invalid RSA private key: {e}"))
}

/// RSASSA-PKCS1-v1_5 sign — deterministic, so no RNG is needed. Concrete digests
/// (rather than a generic) keep the `AssociatedOid` bound resolution simple.
fn rsa_sign_sha1(pem: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(SigningKey::<Sha1>::new(parse_rsa_key(pem)?)
        .sign(data)
        .to_vec())
}

fn rsa_sign_sha256(pem: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(SigningKey::<Sha256>::new(parse_rsa_key(pem)?)
        .sign(data)
        .to_vec())
}

fn rsa_sign_sha512(pem: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(SigningKey::<Sha512>::new(parse_rsa_key(pem)?)
        .sign(data)
        .to_vec())
}

fn base64_std(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn req<'a>(method: SignatureMethod) -> OAuth1Request<'a> {
        OAuth1Request {
            method: "GET",
            base_url: "https://api.example.com/",
            query: "",
            consumer_key: "ck",
            consumer_secret: "cs",
            token: "tok",
            token_secret: "ts",
            signature_method: method,
            realm: "",
            private_key: "",
            callback: "",
            verifier: "",
            timestamp: "",
            version: "",
        }
    }

    // Canonical example from OAuth Core 1.0 Appendix A.5 (photos.example.net).
    #[test]
    fn hmac_sha1_matches_oauth_core_example() {
        let now = Utc.timestamp_opt(1191242096, 0).unwrap();
        let out = sign(
            &OAuth1Request {
                method: "GET",
                base_url: "http://photos.example.net/photos",
                query: "file=vacation.jpg&size=original",
                consumer_key: "dpf43f3p2l4k3l03",
                consumer_secret: "kd94hf93k423kf44",
                token: "nnch734d00sl2jdk",
                token_secret: "pfkkdhi9sl3r4s00",
                signature_method: SignatureMethod::HmacSha1,
                realm: "",
                private_key: "",
                callback: "",
                verifier: "",
                timestamp: "",
                version: "",
            },
            "kllo9940pd9333jh",
            now,
        )
        .unwrap();
        // %-encoded `tR3+Ty81lMeYAr/Fid0kMTYa/WM=`.
        assert!(
            out.header
                .1
                .contains("oauth_signature=\"tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D\""),
            "header was {}",
            out.header.1
        );
        assert!(out.header.1.contains("oauth_token=\"nnch734d00sl2jdk\""));
    }

    #[test]
    fn plaintext_signature_is_the_signing_key() {
        let now = Utc.timestamp_opt(1, 0).unwrap();
        let mut r = req(SignatureMethod::PlainText);
        r.token = "";
        r.token_secret = "";
        let out = sign(&r, "nonce1", now).unwrap();
        // signing key `cs&` → %-encoded `cs%26`.
        assert!(out.header.1.contains("oauth_signature=\"cs%26\""));
        assert!(!out.header.1.contains("oauth_token"));
    }

    #[test]
    fn realm_and_method_labels() {
        let now = Utc.timestamp_opt(1, 0).unwrap();
        let mut r = req(SignatureMethod::HmacSha512);
        r.realm = "Example";
        let out = sign(&r, "n", now).unwrap();
        assert!(out.header.1.starts_with("OAuth realm=\"Example\","));
        assert_eq!(out.method_label, "HMAC-SHA512");
    }

    #[test]
    fn rsa_requires_a_key() {
        let now = Utc.timestamp_opt(1, 0).unwrap();
        assert!(sign(&req(SignatureMethod::RsaSha256), "n", now).is_err());
    }

    #[test]
    fn rsa_signature_verifies() {
        use rsa::pkcs1v15::{Signature, VerifyingKey};
        use rsa::pkcs8::EncodePrivateKey;
        use rsa::signature::Verifier;

        let key = RsaPrivateKey::new(&mut rand_core::OsRng, 1024).unwrap();
        let pem = key
            .to_pkcs8_pem(rsa::pkcs8::LineEnding::LF)
            .unwrap()
            .to_string();
        let sig = rsa_sign_sha256(&pem, b"base string").unwrap();
        // Deterministic (PKCS1v15).
        assert_eq!(sig, rsa_sign_sha256(&pem, b"base string").unwrap());
        // And it verifies against the public key.
        let vk = VerifyingKey::<Sha256>::new(key.to_public_key());
        let signature = Signature::try_from(sig.as_slice()).unwrap();
        assert!(vk.verify(b"base string", &signature).is_ok());
    }

    #[test]
    fn nonce_is_random_hex() {
        let a = gen_nonce();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
