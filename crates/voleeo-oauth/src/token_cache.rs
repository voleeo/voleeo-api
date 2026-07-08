//! Machine-local OAuth 2.0 token store: `responses-local/{ws}/oauth_tokens.yaml`.
//! Never synced (lives under responses-local), keyed by a config hash so every
//! request sharing the same client/endpoint/scope shares one token. Token
//! strings are encrypted at rest when the workspace is encrypted.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use voleeo_core::VoleeoError;
use voleeo_crypto as workspace_key;

/// One cached token. `expires_at` is unix seconds (0 = no expiry). `encrypted`
/// flags whether `access_token`/`refresh_token` are `enc:v1:` at rest.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CachedToken {
    pub key: String,
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub expires_at: i64,
    #[serde(default)]
    encrypted: bool,
}

impl CachedToken {
    pub fn new(
        key: String,
        access_token: String,
        refresh_token: String,
        token_type: String,
        scope: String,
        expires_at: i64,
    ) -> Self {
        Self {
            key,
            access_token,
            refresh_token,
            token_type,
            scope,
            expires_at,
            encrypted: false,
        }
    }

    /// True when the token is past its expiry (with no leeway — callers add skew
    /// when storing `expires_at`). Tokens with `expires_at == 0` never expire.
    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at != 0 && now >= self.expires_at
    }
}

fn cache_path(app_data_dir: &Path, workspace_id: &str) -> PathBuf {
    app_data_dir
        .join("responses-local")
        .join(workspace_id)
        .join("oauth_tokens.yaml")
}

fn read_all(path: &Path) -> Vec<CachedToken> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|c| serde_yaml::from_str(&c).ok())
        .unwrap_or_default()
}

fn write_all(path: &Path, tokens: &[CachedToken]) -> Result<(), VoleeoError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    }
    let content = serde_yaml::to_string(tokens).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    write_owner_only(path, content.as_bytes())
}

/// Write `data`, creating the file 0600 on unix — these tokens are secrets, so it
/// must never be world-readable like the other secret files in the codebase.
#[cfg(unix)]
fn write_owner_only(path: &Path, data: &[u8]) -> Result<(), VoleeoError> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    f.write_all(data)
        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    // `mode()` only applies on creation; re-assert 0600 to repair an existing file.
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(())
}

#[cfg(not(unix))]
fn write_owner_only(path: &Path, data: &[u8]) -> Result<(), VoleeoError> {
    std::fs::write(path, data).map_err(|e| VoleeoError::Storage(e.to_string()))
}

/// Load a token by key, decrypting the secret fields when encrypted.
pub fn load(
    app_data_dir: &Path,
    workspace_id: &str,
    key: &str,
) -> Result<Option<CachedToken>, VoleeoError> {
    let Some(mut token) = read_all(&cache_path(app_data_dir, workspace_id))
        .into_iter()
        .find(|t| t.key == key)
    else {
        return Ok(None);
    };
    if token.encrypted {
        let wk = workspace_key::load_key(workspace_id, app_data_dir)?;
        for field in [&mut token.access_token, &mut token.refresh_token] {
            if workspace_key::is_encrypted(field) {
                *field = workspace_key::decrypt(field, &wk)?;
            }
        }
        token.encrypted = false;
    }
    Ok(Some(token))
}

/// Upsert a token. Encrypts the secret fields when the workspace is encrypted.
pub fn save(
    app_data_dir: &Path,
    workspace_id: &str,
    workspace_encrypted: bool,
    mut token: CachedToken,
) -> Result<(), VoleeoError> {
    if workspace_encrypted {
        let wk = workspace_key::load_key(workspace_id, app_data_dir)?;
        for field in [&mut token.access_token, &mut token.refresh_token] {
            if !field.is_empty() && !workspace_key::is_encrypted(field) {
                *field = workspace_key::encrypt(field, &wk)?;
            }
        }
        token.encrypted = true;
    }
    let path = cache_path(app_data_dir, workspace_id);
    let mut all = read_all(&path);
    all.retain(|t| t.key != token.key);
    all.push(token);
    write_all(&path, &all)
}

/// Remove a token by key (no-op if absent).
pub fn clear(app_data_dir: &Path, workspace_id: &str, key: &str) -> Result<(), VoleeoError> {
    let path = cache_path(app_data_dir, workspace_id);
    let mut all = read_all(&path);
    let before = all.len();
    all.retain(|t| t.key != key);
    if all.len() != before {
        write_all(&path, &all)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_plaintext_token() {
        let dir = tempfile::tempdir().unwrap();
        let token = CachedToken {
            key: "k1".into(),
            access_token: "abc".into(),
            refresh_token: "r1".into(),
            token_type: "Bearer".into(),
            scope: "read".into(),
            expires_at: 100,
            encrypted: false,
        };
        save(dir.path(), "ws", false, token.clone()).unwrap();
        let got = load(dir.path(), "ws", "k1").unwrap().unwrap();
        assert_eq!(got.access_token, "abc");
        assert_eq!(got.expires_at, 100);
        clear(dir.path(), "ws", "k1").unwrap();
        assert!(load(dir.path(), "ws", "k1").unwrap().is_none());
    }

    #[test]
    fn expiry_check() {
        let mut t = CachedToken {
            expires_at: 100,
            ..Default::default()
        };
        assert!(t.is_expired(100));
        assert!(!t.is_expired(99));
        t.expires_at = 0;
        assert!(!t.is_expired(i64::MAX), "0 = never expires");
    }
}
