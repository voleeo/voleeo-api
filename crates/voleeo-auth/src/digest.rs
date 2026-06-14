//! HTTP Digest access authentication (RFC 7616, RFC 2617-compatible). Parses a
//! `WWW-Authenticate: Digest` challenge and computes the `Authorization: Digest`
//! response — MD5 / MD5-sess / SHA-256 / SHA-256-sess, qop `auth` and `auth-int`.
//! Pure: callers supply the cnonce + nonce-count, so it's deterministic to test.

use std::collections::HashMap;

use md5::Md5;
use sha2::{Digest as _, Sha256};

/// A fresh client nonce (16 random bytes, hex) for the `cnonce` field.
pub fn gen_cnonce() -> String {
    let bytes: [u8; 16] = rand::random();
    hex(bytes)
}

/// Hash algorithm offered by the challenge. `*-sess` variants fold the nonce and
/// cnonce into HA1 (RFC 7616 §3.4.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    Md5,
    Md5Sess,
    Sha256,
    Sha256Sess,
}

impl Algorithm {
    fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_uppercase().as_str() {
            "MD5" => Some(Self::Md5),
            "MD5-SESS" => Some(Self::Md5Sess),
            "SHA-256" => Some(Self::Sha256),
            "SHA-256-SESS" => Some(Self::Sha256Sess),
            _ => None,
        }
    }

    /// Token to echo back in the `algorithm=` field — matches the challenge form.
    pub fn label(self) -> &'static str {
        match self {
            Self::Md5 => "MD5",
            Self::Md5Sess => "MD5-sess",
            Self::Sha256 => "SHA-256",
            Self::Sha256Sess => "SHA-256-sess",
        }
    }

    fn is_sess(self) -> bool {
        matches!(self, Self::Md5Sess | Self::Sha256Sess)
    }

    /// Preference when a server offers several challenges — SHA-256 beats MD5.
    fn strength(self) -> u8 {
        match self {
            Self::Sha256 => 4,
            Self::Sha256Sess => 3,
            Self::Md5 => 2,
            Self::Md5Sess => 1,
        }
    }

    fn hash_bytes(self, data: &[u8]) -> String {
        match self {
            Self::Md5 | Self::Md5Sess => hex(Md5::digest(data)),
            Self::Sha256 | Self::Sha256Sess => hex(Sha256::digest(data)),
        }
    }

    fn hash(self, data: &str) -> String {
        self.hash_bytes(data.as_bytes())
    }
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    let mut out = String::with_capacity(bytes.as_ref().len() * 2);
    for b in bytes.as_ref() {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Qop {
    Auth,
    AuthInt,
}

impl Qop {
    fn token(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::AuthInt => "auth-int",
        }
    }
}

/// A parsed `Digest` challenge. `qop`/`opaque` are absent for legacy (RFC 2069)
/// servers.
#[derive(Debug, Clone)]
pub struct Challenge {
    pub realm: String,
    pub nonce: String,
    pub algorithm: Algorithm,
    pub qop: Option<Qop>,
    pub opaque: Option<String>,
}

/// Inputs for the response: the credentials and the request line (plus the body
/// for `auth-int`).
pub struct Request<'a> {
    pub username: &'a str,
    pub password: &'a str,
    pub method: &'a str,
    /// The request-target as it appears on the wire (path + query).
    pub uri: &'a str,
    /// Entity body — only consumed for `qop=auth-int`.
    pub body: &'a [u8],
}

/// Parse comma-separated `key=value` / `key="quoted"` auth-params. Commas inside
/// quotes (e.g. `qop="auth, auth-int"`) don't split.
fn parse_params(input: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b',') {
            i += 1;
        }
        let key_start = i;
        while i < bytes.len() && bytes[i] != b'=' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let key = input[key_start..i].trim().to_ascii_lowercase();
        i += 1; // skip '='
        let value = if i < bytes.len() && bytes[i] == b'"' {
            i += 1;
            let v_start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                if bytes[i] == b'\\' && i + 1 < bytes.len() {
                    i += 1;
                }
                i += 1;
            }
            let v = input[v_start..i].to_string();
            i += 1; // skip closing quote
            v
        } else {
            let v_start = i;
            while i < bytes.len() && bytes[i] != b',' {
                i += 1;
            }
            input[v_start..i].trim().to_string()
        };
        if !key.is_empty() {
            map.insert(key, value);
        }
    }
    map
}

fn parse_qop(qop: &str) -> Option<Qop> {
    let opts: Vec<&str> = qop.split(',').map(str::trim).collect();
    if opts.iter().any(|o| o.eq_ignore_ascii_case("auth")) {
        Some(Qop::Auth)
    } else if opts.iter().any(|o| o.eq_ignore_ascii_case("auth-int")) {
        Some(Qop::AuthInt)
    } else {
        None
    }
}

/// Parse one `WWW-Authenticate: Digest …` header value. Returns `None` for a
/// non-Digest scheme or a challenge missing `realm`/`nonce`.
pub fn parse_challenge(header_value: &str) -> Option<Challenge> {
    let rest = header_value.trim();
    let rest = rest.get(..6).filter(|p| p.eq_ignore_ascii_case("Digest"))?;
    let params = parse_params(&header_value.trim()[rest.len()..]);
    Some(Challenge {
        realm: params.get("realm")?.clone(),
        nonce: params.get("nonce")?.clone(),
        algorithm: params
            .get("algorithm")
            .and_then(|a| Algorithm::parse(a))
            .unwrap_or(Algorithm::Md5),
        qop: params.get("qop").and_then(|q| parse_qop(q)),
        opaque: params.get("opaque").cloned(),
    })
}

/// Pick the strongest supported `Digest` challenge across all `WWW-Authenticate`
/// header values (a server may offer MD5 and SHA-256 side by side).
pub fn pick_challenge<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<Challenge> {
    values
        .into_iter()
        .filter_map(parse_challenge)
        .max_by_key(|c| c.algorithm.strength())
}

/// Build the `Authorization: Digest …` header value for `challenge` + `req`.
/// `nc` is the nonce count (1 for a fresh challenge); `cnonce` is a client nonce
/// the caller generates.
pub fn authorization(challenge: &Challenge, req: &Request, cnonce: &str, nc: u32) -> String {
    let alg = challenge.algorithm;
    let ha1_base = alg.hash(&format!(
        "{}:{}:{}",
        req.username, challenge.realm, req.password
    ));
    let ha1 = if alg.is_sess() {
        alg.hash(&format!("{ha1_base}:{}:{cnonce}", challenge.nonce))
    } else {
        ha1_base
    };

    let ha2 = match challenge.qop {
        Some(Qop::AuthInt) => {
            let body = alg.hash_bytes(req.body);
            alg.hash(&format!("{}:{}:{body}", req.method, req.uri))
        }
        _ => alg.hash(&format!("{}:{}", req.method, req.uri)),
    };

    let nc_hex = format!("{nc:08x}");
    let response = match challenge.qop {
        Some(qop) => alg.hash(&format!(
            "{ha1}:{}:{nc_hex}:{cnonce}:{}:{ha2}",
            challenge.nonce,
            qop.token(),
        )),
        None => alg.hash(&format!("{ha1}:{}:{ha2}", challenge.nonce)),
    };

    let mut parts = vec![
        format!("username=\"{}\"", req.username),
        format!("realm=\"{}\"", challenge.realm),
        format!("nonce=\"{}\"", challenge.nonce),
        format!("uri=\"{}\"", req.uri),
        format!("algorithm={}", alg.label()),
        format!("response=\"{response}\""),
    ];
    if let Some(qop) = challenge.qop {
        parts.push(format!("qop={}", qop.token()));
        parts.push(format!("nc={nc_hex}"));
        parts.push(format!("cnonce=\"{cnonce}\""));
    }
    if let Some(opaque) = &challenge.opaque {
        parts.push(format!("opaque=\"{opaque}\""));
    }
    format!("Digest {}", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7616 §3.9.1 — SHA-256 example.
    #[test]
    fn rfc7616_sha256_vector() {
        let challenge = parse_challenge(
            r#"Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS""#,
        )
        .unwrap();
        assert_eq!(challenge.algorithm, Algorithm::Sha256);
        assert_eq!(challenge.qop, Some(Qop::Auth));
        let header = authorization(
            &challenge,
            &Request {
                username: "Mufasa",
                password: "Circle of Life",
                method: "GET",
                uri: "/dir/index.html",
                body: b"",
            },
            "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
            1,
        );
        assert!(header.contains(
            "response=\"753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1\""
        ));
        assert!(header.contains("qop=auth"));
        assert!(header.contains("nc=00000001"));
    }

    /// RFC 2617 §3.5 — MD5 "Circle Of Life" example.
    #[test]
    fn rfc2617_md5_vector() {
        let challenge = parse_challenge(
            r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#,
        )
        .unwrap();
        assert_eq!(challenge.algorithm, Algorithm::Md5);
        let header = authorization(
            &challenge,
            &Request {
                username: "Mufasa",
                password: "Circle Of Life",
                method: "GET",
                uri: "/dir/index.html",
                body: b"",
            },
            "0a4f113b",
            1,
        );
        assert!(header.contains("response=\"6629fae49393a05397450978507c4ef1\""));
    }

    /// Legacy RFC 2069 (no qop): response = H(HA1:nonce:HA2).
    #[test]
    fn rfc2069_no_qop() {
        let challenge = parse_challenge(r#"Digest realm="r", nonce="n", algorithm=MD5"#).unwrap();
        assert_eq!(challenge.qop, None);
        let header = authorization(
            &challenge,
            &Request {
                username: "u",
                password: "p",
                method: "GET",
                uri: "/",
                body: b"",
            },
            "ignored",
            1,
        );
        // No qop ⇒ no nc/cnonce/qop fields.
        assert!(!header.contains("qop="));
        assert!(!header.contains("cnonce="));
    }

    #[test]
    fn picks_strongest_algorithm() {
        let md5 = r#"Digest realm="r", nonce="a", algorithm=MD5"#;
        let sha = r#"Digest realm="r", nonce="b", algorithm=SHA-256"#;
        let picked = pick_challenge([md5, sha]).unwrap();
        assert_eq!(picked.algorithm, Algorithm::Sha256);
        assert_eq!(picked.nonce, "b");
    }

    #[test]
    fn parses_quoted_commas_in_qop() {
        let c = parse_challenge(r#"Digest realm="a,b", nonce="n", qop="auth, auth-int""#).unwrap();
        assert_eq!(c.realm, "a,b");
        assert_eq!(c.qop, Some(Qop::Auth));
    }

    #[test]
    fn rejects_non_digest_scheme() {
        assert!(parse_challenge(r#"Basic realm="r""#).is_none());
    }
}
