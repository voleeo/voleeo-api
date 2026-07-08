//! Mask secret material before returning stored workspace data to the MCP
//! client. Read tools serialize requests / envs / cookies straight to the AI;
//! on an unencrypted workspace those carry plaintext tokens, passwords, and
//! cookie values. We replace secrets with a marker unless the caller opts into
//! plaintext with `reveal: true`. The send/resolve paths read from storage
//! directly, so masking the read tools never affects request execution.

use serde_json::Value;
use voleeo_core::{AuthConfig, CookieJar, Environment};

/// Sentinel returned in place of a secret. Distinctive so a read→write
/// round-trip that echoes it back can be detected (see `restore_masked`).
pub(super) const MASK: &str = "__voleeo_hidden__ (pass reveal=true to read)";

/// Whether the tool args opt into plaintext secrets.
pub(super) fn reveal(args: &Value) -> bool {
    args["reveal"].as_bool().unwrap_or(false)
}

pub(super) fn mask_auth(auth: &mut AuthConfig) {
    for (secret, _) in auth.secret_fields_mut() {
        if !secret.is_empty() {
            *secret = MASK.to_string();
        }
    }
}

pub(super) fn mask_env(env: &mut Environment) {
    for var in env.variables.iter_mut() {
        if !var.value.is_empty() {
            var.value = MASK.to_string();
        }
    }
}

pub(super) fn mask_cookies(jar: &mut CookieJar) {
    for c in jar.cookies.iter_mut() {
        if !c.value.is_empty() {
            c.value = MASK.to_string();
        }
    }
}

/// Stop a masked read→update round-trip from wiping a real secret: when the
/// incoming auth is the same scheme as the stored one, restore any secret field
/// the caller left as the `MASK` marker from the stored value.
pub(super) fn restore_masked(new: &mut AuthConfig, old: &mut AuthConfig) {
    if std::mem::discriminant(&*new) != std::mem::discriminant(&*old) {
        return;
    }
    let prev: Vec<String> = old
        .secret_fields_mut()
        .into_iter()
        .map(|(s, _)| s.clone())
        .collect();
    for ((secret, _), old_val) in new.secret_fields_mut().into_iter().zip(prev) {
        if secret == MASK {
            *secret = old_val;
        }
    }
}

/// True when a write tool was handed the read-mask marker as a value — the
/// caller echoed a masked read back instead of a real secret.
pub(super) fn is_mask(value: &str) -> bool {
    value == MASK
}

/// Strip query string and userinfo from a URL for logging — avoids leaking
/// query-param API keys or `user:pass@` credentials into stderr / log files.
pub(super) fn redact_url(url: &str) -> String {
    let no_query = url.split('?').next().unwrap_or(url);
    match no_query.split_once("://") {
        Some((scheme, rest)) => {
            let host = rest.split_once('@').map(|(_, h)| h).unwrap_or(rest);
            format!("{scheme}://{host}")
        }
        None => no_query.to_string(),
    }
}

/// Redact any URLs embedded in an error message before it reaches the MCP
/// client — transport errors echo the resolved URL, query secrets included.
pub(super) fn redact_error(msg: &str) -> String {
    if !msg.contains("://") {
        return msg.to_string();
    }
    msg.split_whitespace()
        .map(|w| {
            if w.contains("://") {
                redact_url(w)
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bearer(token: &str) -> AuthConfig {
        AuthConfig::Bearer {
            token: token.into(),
            token_encrypted: false,
            enabled: true,
        }
    }

    #[test]
    fn masks_then_restores_same_scheme() {
        let mut a = bearer("secret");
        mask_auth(&mut a);
        assert_eq!(a.secret_fields_mut().into_iter().next().unwrap().0, MASK);

        // Caller echoes the masked value back on update; restore keeps the secret.
        let mut old = bearer("secret");
        restore_masked(&mut a, &mut old);
        assert_eq!(
            a.secret_fields_mut().into_iter().next().unwrap().0,
            "secret"
        );
    }

    #[test]
    fn restore_skips_when_scheme_differs() {
        let mut new = bearer(MASK);
        let mut old = AuthConfig::None;
        restore_masked(&mut new, &mut old); // no panic, no restore possible
        assert_eq!(new.secret_fields_mut().into_iter().next().unwrap().0, MASK);
    }

    #[test]
    fn redact_error_strips_embedded_url_secrets() {
        let out = redact_error("error sending request for url https://h.com/a?key=sek : timed out");
        assert!(!out.contains("key=sek"), "secret leaked: {out}");
        assert!(out.contains("https://h.com/a"));
        assert_eq!(redact_error("plain message"), "plain message");
    }

    #[test]
    fn redact_url_strips_query_and_userinfo() {
        assert_eq!(
            redact_url("https://u:p@host.com/a?key=sek"),
            "https://host.com/a"
        );
        assert_eq!(redact_url("https://host.com/a"), "https://host.com/a");
    }
}
