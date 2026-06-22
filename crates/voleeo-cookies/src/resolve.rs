//! Send-time resolution of cookie fields. Three layers, applied in order:
//!   1. `{{ VAR }}` env-var tokens          → substitute
//!   2. `{{ encrypt(value="…") }}` chips    → unwrap to inner value
//!   3. `enc:v1:<hex>` ciphertext           → decrypt with workspace key
//!
//! Pure module — env vars and workspace key are passed in; callers own the
//! store / keychain lookups. Other request fields (URL, headers, body, auth)
//! get (1) frontend-side and (3) via the at-rest `value_encrypted` flag;
//! cookies bypass both because they live in a separate jar.

use std::collections::HashMap;

use crate::model::StoredCookie;

/// Resolve every cookie's `domain`/`value`/`path` in-place. `key = None`
/// for unencrypted workspaces — `enc:v1:` substrings then survive to the
/// wire as a visible failure rather than silent empties.
pub fn resolve_cookies(
    cookies: &mut [StoredCookie],
    vars: &HashMap<String, String>,
    key: Option<&[u8; 32]>,
) {
    for c in cookies.iter_mut() {
        c.domain = normalize_domain(&resolve_field(&c.domain, vars, key));
        c.value = resolve_field(&c.value, vars, key);
        c.path = resolve_field(&c.path, vars, key);
    }
}

/// Reduce a domain to a bare host so a URL-form value (e.g. `{{ HOST }}`
/// resolving to `https://httpbin.org`) still domain-matches the request host.
/// Strips scheme, path, and port; preserves a leading `.` (subdomain match).
pub fn normalize_domain(domain: &str) -> String {
    let mut d = domain.trim();
    if let Some(pos) = d.find("://") {
        d = &d[pos + 3..];
    }
    if let Some(slash) = d.find('/') {
        d = &d[..slash];
    }
    // Strip a trailing `:port` (skip the IPv6 bracket form `[::1]`).
    if !d.starts_with('[')
        && let Some(colon) = d.rfind(':')
    {
        let port = &d[colon + 1..];
        if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) {
            d = &d[..colon];
        }
    }
    d.to_ascii_lowercase()
}

fn resolve_field(text: &str, vars: &HashMap<String, String>, key: Option<&[u8; 32]>) -> String {
    let with_vars = resolve_vars(text, vars);
    let unchipped = strip_encrypt_chips(&with_vars);
    decrypt_inline(&unchipped, key)
}

/// Substitute `{{ NAME }}` identifier tokens. Function-call tokens like
/// `{{ encrypt(value=…) }}` pass through to the next pass. Missing vars are
/// kept verbatim so the user sees the unresolved name on the wire.
fn resolve_vars(text: &str, vars: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        result.push_str(&rest[..open]);
        rest = &rest[open + 2..];
        let Some(close) = rest.find("}}") else {
            result.push_str("{{");
            result.push_str(rest);
            return result;
        };
        let inner = rest[..close].trim();
        rest = &rest[close + 2..];
        if is_identifier(inner) {
            if let Some(val) = vars.get(inner) {
                result.push_str(val);
            } else {
                result.push_str("{{ ");
                result.push_str(inner);
                result.push_str(" }}");
            }
        } else {
            result.push_str("{{ ");
            result.push_str(inner);
            result.push_str(" }}");
        }
    }
    result.push_str(rest);
    result
}

fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_alphabetic() || c == '_')
        && chars.all(|c| c.is_alphanumeric() || c == '_')
}

/// Unwrap every `{{ encrypt(value="…") }}` chip to its inner `value` arg
/// (usually `enc:v1:<hex>`, fed to `decrypt_inline` next). Literal-string
/// match is safe because the chip format is hand-written by
/// `template::serializeFuncToken` — avoids pulling in a regex dep.
fn strip_encrypt_chips(text: &str) -> String {
    let prefix = r#"{{ encrypt(value=""#;
    let suffix = r#"") }}"#;
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(prefix) {
        result.push_str(&rest[..idx]);
        let after = &rest[idx + prefix.len()..];
        if let Some(end) = after.find(suffix) {
            result.push_str(&after[..end]);
            rest = &after[end + suffix.len()..];
        } else {
            // Malformed chip — flush remainder verbatim and stop.
            result.push_str(&rest[idx..]);
            return result;
        }
    }
    result.push_str(rest);
    result
}

/// Decrypt-only counterpart to `resolve_cookies` — used when the frontend
/// has already done env-var sub + chip-strip, leaving only `enc:v1:` blobs.
pub fn decrypt_cookies(cookies: &mut [StoredCookie], key: Option<&[u8; 32]>) {
    for c in cookies.iter_mut() {
        c.domain = normalize_domain(&decrypt_inline(&c.domain, key));
        c.value = decrypt_inline(&c.value, key);
        c.path = decrypt_inline(&c.path, key);
    }
}

/// Replace each `enc:v1:<hex>` substring with its plaintext. On failure the
/// ciphertext is left in place — visible breakage beats silent empties.
fn decrypt_inline(text: &str, key: Option<&[u8; 32]>) -> String {
    let Some(key) = key else {
        return text.to_string();
    };
    let prefix = "enc:v1:";
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(prefix) {
        result.push_str(&rest[..idx]);
        let after_prefix = &rest[idx + prefix.len()..];
        // Hex blob runs to the first non-hex byte.
        let hex_len = after_prefix
            .as_bytes()
            .iter()
            .take_while(|b| b.is_ascii_hexdigit())
            .count();
        let total = prefix.len() + hex_len;
        let cipher = &rest[idx..idx + total];
        match voleeo_crypto::decrypt(cipher, key) {
            Ok(plain) => result.push_str(&plain),
            Err(_) => result.push_str(cipher),
        }
        rest = &rest[idx + total..];
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::StoredCookie;

    fn cookie_with(value: &str, domain: &str, path: &str) -> StoredCookie {
        StoredCookie {
            id: "ck_x".into(),
            domain: domain.into(),
            host_only: true,
            path: path.into(),
            name: "n".into(),
            value: value.into(),
            value_encrypted: false,
            secure: false,
            http_only: false,
            same_site: None,
            expires: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn resolves_simple_var_in_value() {
        let mut vars = HashMap::new();
        vars.insert("TOKEN".into(), "abc123".into());
        let mut cs = vec![cookie_with("Bearer {{ TOKEN }}", "example.com", "/")];
        resolve_cookies(&mut cs, &vars, None);
        assert_eq!(cs[0].value, "Bearer abc123");
    }

    #[test]
    fn resolves_var_in_domain_and_path() {
        let mut vars = HashMap::new();
        vars.insert("HOST".into(), "api.example.com".into());
        vars.insert("BASE".into(), "/v1".into());
        let mut cs = vec![cookie_with("x", "{{ HOST }}", "{{ BASE }}")];
        resolve_cookies(&mut cs, &vars, None);
        assert_eq!(cs[0].domain, "api.example.com");
        assert_eq!(cs[0].path, "/v1");
    }

    #[test]
    fn url_form_domain_reduced_to_host() {
        // A `{{ HOST }}` that resolves to a full URL must still match the host.
        let mut vars = HashMap::new();
        vars.insert("HOST".into(), "https://httpbin.org".into());
        let mut cs = vec![cookie_with("x", "{{ HOST }}", "/")];
        resolve_cookies(&mut cs, &vars, None);
        assert_eq!(cs[0].domain, "httpbin.org");
    }

    #[test]
    fn normalize_domain_strips_scheme_path_port() {
        assert_eq!(normalize_domain("https://httpbin.org:443/x"), "httpbin.org");
        assert_eq!(normalize_domain("example.com"), "example.com");
        assert_eq!(normalize_domain(".example.com"), ".example.com");
    }

    #[test]
    fn missing_var_kept_verbatim() {
        let mut cs = vec![cookie_with("{{ UNSET }}", "example.com", "/")];
        resolve_cookies(&mut cs, &HashMap::new(), None);
        assert_eq!(cs[0].value, "{{ UNSET }}");
    }

    #[test]
    fn strips_encrypt_chip_wrapping() {
        let mut cs = vec![cookie_with(
            r#"{{ encrypt(value="inner") }}"#,
            "example.com",
            "/",
        )];
        resolve_cookies(&mut cs, &HashMap::new(), None);
        assert_eq!(cs[0].value, "inner");
    }

    #[test]
    fn decrypt_inline_round_trip() {
        let key = voleeo_crypto::generate_key();
        let cipher = voleeo_crypto::encrypt("session-secret", &key).unwrap();
        let mut cs = vec![cookie_with(&cipher, "example.com", "/")];
        resolve_cookies(&mut cs, &HashMap::new(), Some(&key));
        assert_eq!(cs[0].value, "session-secret");
    }

    #[test]
    fn chip_then_decrypt_two_layer() {
        // Mirrors the UI's stored shape: {{ encrypt(value="enc:v1:…") }}.
        let key = voleeo_crypto::generate_key();
        let cipher = voleeo_crypto::encrypt("api-key-42", &key).unwrap();
        let stored = format!(r#"{{{{ encrypt(value="{cipher}") }}}}"#);
        let mut cs = vec![cookie_with(&stored, "example.com", "/")];
        resolve_cookies(&mut cs, &HashMap::new(), Some(&key));
        assert_eq!(cs[0].value, "api-key-42");
    }

    #[test]
    fn no_key_leaves_ciphertext_visible() {
        let key = voleeo_crypto::generate_key();
        let cipher = voleeo_crypto::encrypt("s", &key).unwrap();
        let mut cs = vec![cookie_with(&cipher, "example.com", "/")];
        resolve_cookies(&mut cs, &HashMap::new(), None);
        // Cipher passes through — visible failure beats silent empty.
        assert_eq!(cs[0].value, cipher);
    }

    #[test]
    fn function_token_not_encrypt_kept_verbatim() {
        // Non-identifier, non-encrypt tokens round-trip unchanged.
        let mut cs = vec![cookie_with("{{ uuid.v4() }}", "example.com", "/")];
        resolve_cookies(&mut cs, &HashMap::new(), None);
        assert_eq!(cs[0].value, "{{ uuid.v4() }}");
    }
}
