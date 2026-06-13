//! AWS Signature Version 4 (the `Authorization`-header flavor).
//!
//! Pipeline per the AWS spec: canonical request → string-to-sign → derived
//! signing key → signature → `Authorization` header. We sign a minimal header
//! set (`host`, `x-amz-date`, `x-amz-content-sha256`, plus `x-amz-security-token`
//! when a session token is present); unsigned request headers are ignored by
//! AWS, so this stays correct regardless of what else is on the wire.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::encode::{hex_lower, percent_decode, uri_encode};

type HmacSha256 = Hmac<Sha256>;

/// The final request as it will hit the wire, decomposed into the pieces SigV4
/// canonicalizes. `host` is the `Host` header value (includes `:port` only for
/// non-default ports). `payload_sha256` is the lowercase hex digest of the body,
/// or `"UNSIGNED-PAYLOAD"` when the body can't be buffered (streams/multipart).
pub struct SigV4Request<'a> {
    pub method: &'a str,
    pub host: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub payload_sha256: &'a str,
    pub access_key: &'a str,
    pub secret_key: &'a str,
    pub session_token: Option<&'a str>,
    pub region: &'a str,
    pub service: &'a str,
}

/// Headers to inject before sending, plus signing metadata for the timeline.
pub struct SignedSigV4 {
    /// `(name, value)` pairs: `x-amz-date`, `x-amz-content-sha256`, optional
    /// `x-amz-security-token`, and `authorization`.
    pub headers: Vec<(String, String)>,
    pub credential_scope: String,
    pub signed_headers: String,
}

/// SHA-256 of `payload`, lowercase hex — what callers pass as `payload_sha256`.
pub fn payload_hash(payload: &[u8]) -> String {
    hex_lower(&Sha256::digest(payload))
}

/// Hash of the empty body — the common case for GET/DELETE.
pub fn empty_payload_hash() -> String {
    payload_hash(b"")
}

pub fn sign(req: &SigV4Request, now: DateTime<Utc>) -> SignedSigV4 {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    // Headers we sign, lowercased + sorted by name. Always host + x-amz-date +
    // x-amz-content-sha256; security token when present.
    let mut signed: Vec<(String, String)> = vec![
        ("host".into(), req.host.to_string()),
        (
            "x-amz-content-sha256".into(),
            req.payload_sha256.to_string(),
        ),
        ("x-amz-date".into(), amz_date.clone()),
    ];
    if let Some(token) = req.session_token.filter(|t| !t.is_empty()) {
        signed.push(("x-amz-security-token".into(), token.to_string()));
    }
    signed.sort_by(|a, b| a.0.cmp(&b.0));

    let canonical_headers: String = signed
        .iter()
        .map(|(k, v)| format!("{k}:{}\n", v.trim()))
        .collect();
    let signed_headers = signed
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");

    let canonical_request = build_canonical_request(
        req.method,
        &canonical_uri(req.path, req.service),
        &canonical_query(req.query),
        &canonical_headers,
        &signed_headers,
        req.payload_sha256,
    );

    let credential_scope = format!("{date_stamp}/{}/{}/aws4_request", req.region, req.service);
    let string_to_sign = build_string_to_sign(
        &amz_date,
        &credential_scope,
        &hex_lower(&Sha256::digest(canonical_request.as_bytes())),
    );

    let key = derive_signing_key(req.secret_key, &date_stamp, req.region, req.service);
    let signature = hex_lower(&hmac(&key, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        req.access_key
    );

    let mut headers = vec![
        ("x-amz-date".to_string(), amz_date),
        (
            "x-amz-content-sha256".to_string(),
            req.payload_sha256.to_string(),
        ),
    ];
    if let Some(token) = req.session_token.filter(|t| !t.is_empty()) {
        headers.push(("x-amz-security-token".to_string(), token.to_string()));
    }
    headers.push(("authorization".to_string(), authorization));

    SignedSigV4 {
        headers,
        credential_scope,
        signed_headers,
    }
}

fn build_canonical_request(
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    canonical_headers: &str,
    signed_headers: &str,
    payload_hash: &str,
) -> String {
    format!("{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}")
}

fn build_string_to_sign(amz_date: &str, scope: &str, hashed_canonical: &str) -> String {
    format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashed_canonical}")
}

/// Encode each path segment per RFC 3986; non-S3 services encode twice (the
/// classic SigV4 double-encoding). Slashes between segments stay literal.
fn canonical_uri(path: &str, service: &str) -> String {
    if path.is_empty() {
        return "/".to_string();
    }
    let double = service != "s3";
    path.split('/')
        .map(|seg| {
            let once = uri_encode(seg);
            if double {
                uri_encode(&once)
            } else {
                once
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Sort params by encoded key (then value), re-encoding the decoded form so the
/// result is canonical regardless of how the incoming query was escaped.
fn canonical_query(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }
    let mut pairs: Vec<(String, String)> = query
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
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn derive_signing_key(secret: &str, date_stamp: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac(format!("AWS4{secret}").as_bytes(), date_stamp.as_bytes());
    let k_region = hmac(&k_date, region.as_bytes());
    let k_service = hmac(&k_region, service.as_bytes());
    hmac(&k_service, b"aws4_request")
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    // Worked example from the AWS SigV4 docs ("Examples of the complete
    // Signature Version 4 signing process"): GET on the IAM ListUsers endpoint.
    const SECRET: &str = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    const ACCESS: &str = "AKIDEXAMPLE";

    #[test]
    fn canonical_request_hash_matches_aws_example() {
        // The example signs content-type;host;x-amz-date over an empty payload.
        let canonical_headers = "content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:iam.amazonaws.com\nx-amz-date:20150830T123600Z\n";
        let cr = build_canonical_request(
            "GET",
            &canonical_uri("/", "iam"),
            &canonical_query("Action=ListUsers&Version=2010-05-08"),
            canonical_headers,
            "content-type;host;x-amz-date",
            &empty_payload_hash(),
        );
        let hash = hex_lower(&Sha256::digest(cr.as_bytes()));
        assert_eq!(
            hash,
            "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59"
        );
    }

    #[test]
    fn signature_matches_aws_example() {
        let canonical_headers = "content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:iam.amazonaws.com\nx-amz-date:20150830T123600Z\n";
        let cr = build_canonical_request(
            "GET",
            "/",
            &canonical_query("Action=ListUsers&Version=2010-05-08"),
            canonical_headers,
            "content-type;host;x-amz-date",
            &empty_payload_hash(),
        );
        let scope = "20150830/us-east-1/iam/aws4_request";
        let sts = build_string_to_sign(
            "20150830T123600Z",
            scope,
            &hex_lower(&Sha256::digest(cr.as_bytes())),
        );
        let key = derive_signing_key(SECRET, "20150830", "us-east-1", "iam");
        let signature = hex_lower(&hmac(&key, sts.as_bytes()));
        assert_eq!(
            signature,
            "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
        );
    }

    #[test]
    fn empty_payload_hash_is_known_constant() {
        assert_eq!(
            empty_payload_hash(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sign_produces_well_formed_authorization() {
        let now = Utc.with_ymd_and_hms(2015, 8, 30, 12, 36, 0).unwrap();
        let out = sign(
            &SigV4Request {
                method: "GET",
                host: "iam.amazonaws.com",
                path: "/",
                query: "Action=ListUsers&Version=2010-05-08",
                payload_sha256: &empty_payload_hash(),
                access_key: ACCESS,
                secret_key: SECRET,
                session_token: None,
                region: "us-east-1",
                service: "iam",
            },
            now,
        );
        assert_eq!(out.signed_headers, "host;x-amz-content-sha256;x-amz-date");
        assert_eq!(out.credential_scope, "20150830/us-east-1/iam/aws4_request");
        let auth = &out
            .headers
            .iter()
            .find(|(k, _)| k == "authorization")
            .unwrap()
            .1;
        assert!(auth.starts_with(
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request"
        ));
        assert!(auth.contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date"));
        assert!(auth.contains("Signature="));
        // No session token → no security-token header.
        assert!(!out.headers.iter().any(|(k, _)| k == "x-amz-security-token"));
    }

    #[test]
    fn session_token_adds_signed_header() {
        let now = Utc.with_ymd_and_hms(2015, 8, 30, 12, 36, 0).unwrap();
        let out = sign(
            &SigV4Request {
                method: "GET",
                host: "example.execute-api.us-east-1.amazonaws.com",
                path: "/prod/items",
                query: "",
                payload_sha256: &empty_payload_hash(),
                access_key: ACCESS,
                secret_key: SECRET,
                session_token: Some("FQoGZXIvYXdzEH"),
                region: "us-east-1",
                service: "execute-api",
            },
            now,
        );
        assert!(out.signed_headers.contains("x-amz-security-token"));
        assert!(out
            .headers
            .iter()
            .any(|(k, v)| k == "x-amz-security-token" && v == "FQoGZXIvYXdzEH"));
    }

    #[test]
    fn canonical_query_sorts_and_encodes() {
        assert_eq!(
            canonical_query("Version=2010-05-08&Action=ListUsers"),
            "Action=ListUsers&Version=2010-05-08"
        );
        assert_eq!(canonical_query("q=hello world"), "q=hello%20world");
        assert_eq!(canonical_query("q=hello%20world"), "q=hello%20world");
    }

    #[test]
    fn canonical_uri_double_encodes_non_s3() {
        // A space in a path segment → %20 once, then %2520 (double) for non-S3.
        assert_eq!(canonical_uri("/a b", "execute-api"), "/a%2520b");
        // S3 encodes once.
        assert_eq!(canonical_uri("/a b", "s3"), "/a%20b");
    }
}
