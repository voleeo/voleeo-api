//! Secret-handling helpers for saved snapshots: detect redaction, and
//! encrypt/redact/decrypt the one auth value folded into a header or URL query.

use crate::snapshot::REDACTED;
use voleeo_core::{ApiKeyLocation, AuthConfig, HttpRequest, Snapshot, VoleeoError};

/// True when replaying `snapshot` can't recover real auth — an unencrypted-
/// workspace snapshot had its secrets redacted (not just hidden) at save time, so
/// there's nothing to decrypt or re-sign with.
pub fn has_redacted_secrets(snapshot: &Snapshot) -> bool {
    if snapshot.encrypted {
        return false;
    }
    let mut auth = snapshot.request.auth.clone();
    if auth
        .secret_fields_mut()
        .iter()
        .any(|(v, _)| v.as_str() == REDACTED)
    {
        return true;
    }
    snapshot.request.headers.iter().any(|h| h.value == REDACTED)
        || snapshot.request.url.contains(REDACTED)
}

/// Static auth (Bearer/Basic/ApiKey) — and OAuth2, which resolves to a cached
/// token and is folded into a literal `Authorization: Bearer` header the same
/// way — is injected into a literal header or URL query value before the
/// backend ever sees the resolved request; see `SnapshotStore::save` docs.
/// `treat` is either "encrypt in place" or "replace with a redaction
/// placeholder", applied to just that one value.
pub(crate) fn treat_static_auth_injection(
    request: &mut HttpRequest,
    original_auth: &AuthConfig,
    mut treat: impl FnMut(&str) -> Result<String, VoleeoError>,
) -> Result<(), VoleeoError> {
    match original_auth {
        AuthConfig::Bearer { enabled: true, .. }
        | AuthConfig::Basic { enabled: true, .. }
        | AuthConfig::OAuth2 { enabled: true, .. } => {
            for h in &mut request.headers {
                if h.name.eq_ignore_ascii_case("authorization") {
                    h.value = treat(&h.value)?;
                }
            }
        }
        AuthConfig::ApiKey {
            key,
            location: ApiKeyLocation::Header,
            enabled: true,
            ..
        } => {
            for h in &mut request.headers {
                if h.name.eq_ignore_ascii_case(key) {
                    h.value = treat(&h.value)?;
                }
            }
        }
        // ponytail: naive `key=` substring match, no percent-decoding — covers
        // the common case; a value containing a literal "key=" elsewhere in
        // the URL would false-positive. Upgrade to a real query parser if that
        // ever bites.
        AuthConfig::ApiKey {
            key,
            location: ApiKeyLocation::Query,
            enabled: true,
            ..
        } => {
            if let Some(idx) = request.url.find(&format!("{key}=")) {
                let start = idx + key.len() + 1;
                let end = request.url[start..]
                    .find('&')
                    .map(|i| start + i)
                    .unwrap_or(request.url.len());
                let value = request.url[start..end].to_string();
                let treated = treat(&value)?;
                request.url.replace_range(start..end, &treated);
            }
        }
        _ => {}
    }
    Ok(())
}

/// Symmetric inverse of the query-value branch above: find an `enc:v1:`
/// ciphertext token embedded in the URL (query value only — see the ponytail
/// note there) and decrypt it in place.
pub(crate) fn decrypt_url_ciphertext(url: &mut String, key: &[u8; 32]) -> Result<(), VoleeoError> {
    const PREFIX: &str = "enc:v1:";
    let Some(idx) = url.find(PREFIX) else {
        return Ok(());
    };
    let end = url[idx..].find('&').map(|i| idx + i).unwrap_or(url.len());
    let ciphertext = url[idx..end].to_string();
    let plain = voleeo_crypto::decrypt(&ciphertext, key)?;
    url.replace_range(idx..end, &plain);
    Ok(())
}
