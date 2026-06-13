//! OAuth 2.0 pure helpers — PKCE (RFC 7636) and CSRF state. Token requests and
//! the cache live in `src-tauri` (they need reqwest/serde); this module stays
//! free of I/O so the crypto is unit-testable against the RFC vectors.

use base64::Engine;
use sha2::{Digest, Sha256};

use crate::encode::hex_lower;

const URL_SAFE: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// Stable cache key for a token: sha256 of the identity-defining config fields,
/// so every request sharing the same client/endpoint/scope shares one token.
pub fn config_hash(parts: &[&str]) -> String {
    hex_lower(&Sha256::digest(parts.join("\u{0}").as_bytes()))
}

/// A PKCE pair: the `verifier` is kept client-side; the `challenge` (S256) goes
/// on the authorization request.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// S256 code challenge for a verifier: base64url(sha256(verifier)), no padding.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE.encode(Sha256::digest(verifier.as_bytes()))
}

/// Fresh PKCE pair — 32 random bytes base64url-encoded (a 43-char verifier).
pub fn gen_pkce() -> Pkce {
    let verifier = random_token();
    let challenge = pkce_challenge(&verifier);
    Pkce {
        verifier,
        challenge,
    }
}

/// A fresh code verifier (43-char base64url) for callers that need to derive the
/// challenge themselves (e.g. a `plain` method or a user-supplied verifier).
pub fn gen_verifier() -> String {
    random_token()
}

/// Opaque CSRF `state` for the authorization-code redirect.
pub fn gen_state() -> String {
    random_token()
}

fn random_token() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        // RFC 7636 Appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn gen_pkce_is_url_safe_and_consistent() {
        let p = gen_pkce();
        assert_eq!(p.verifier.len(), 43, "32 bytes base64url = 43 chars");
        assert!(p
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        // Challenge derives from the verifier.
        assert_eq!(p.challenge, pkce_challenge(&p.verifier));
    }

    #[test]
    fn state_is_random_and_distinct() {
        assert_ne!(gen_state(), gen_state());
    }
}
