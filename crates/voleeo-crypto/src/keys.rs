/// Workspace key lifecycle: generation, OS keychain storage, fallback keyfile,
/// and human-readable key encoding.
///
/// Key storage strategy (both written on save, keychain tried first on load):
///   1. OS keychain via the `keyring` crate (preferred — OS-managed security)
///   2. `{app_data_dir}/keys/{workspace_id}.key` at mode 0600 (reliable fallback)
///
/// Key display format: 32 bytes as uppercase hex, 8 groups of 8 chars separated
/// by dashes — e.g. `DEADBEEF-CAFEF00D-…` (71 chars total).
use std::path::{Path, PathBuf};

use rand::Rng;
use voleeo_core::VoleeoError;

use crate::cipher::{from_hex, to_hex};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const KEYRING_SERVICE: &str = "voleeo";

/// Generate a cryptographically random 256-bit (32-byte) workspace key.
pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::rng().fill_bytes(&mut key);
    key
}

/// Encode 32 bytes as `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`
/// (8 groups of 8 uppercase hex chars separated by dashes; 71 chars total).
pub fn encode_key_display(key: &[u8; 32]) -> String {
    let hex = to_hex(key);
    hex.as_bytes()
        .chunks(8)
        .map(|c| std::str::from_utf8(c).expect("hex is ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Parse a key produced by `encode_key_display` (dashes and spaces are ignored,
/// input is case-insensitive).
pub fn decode_key_display(s: &str) -> Result<[u8; 32], VoleeoError> {
    let normalised: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect();

    if normalised.len() != 64 {
        return Err(VoleeoError::Crypto(format!(
            "invalid key: expected 64 hex chars, got {}",
            normalised.len()
        )));
    }

    let bytes = from_hex(&normalised)?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

// Keys live at {app_data_dir}/keys/{workspace_id}.key — intentionally outside
// the workspace directory so they are never included in a sync-dir symlink and
// can never end up in a Git repository.

// Mirrors voleeo_storage::validate_id, which this crate can't depend on
// without a dependency cycle (storage depends on crypto).
fn validate_workspace_id(id: &str) -> Result<(), VoleeoError> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(VoleeoError::Crypto(format!("invalid workspace id '{id}'")))
    }
}

fn key_file_path(workspace_id: &str, app_data_dir: &Path) -> Result<PathBuf, VoleeoError> {
    validate_workspace_id(workspace_id)?;
    Ok(app_data_dir
        .join("keys")
        .join(format!("{workspace_id}.key")))
}

fn keyring_entry(workspace_id: &str) -> keyring_core::Result<keyring_core::Entry> {
    keyring_core::Entry::new(KEYRING_SERVICE, &format!("workspace-key:{workspace_id}"))
}

fn save_key_to_file(
    workspace_id: &str,
    key: &[u8; 32],
    app_data_dir: &Path,
) -> Result<(), VoleeoError> {
    let path = key_file_path(workspace_id, app_data_dir)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    }
    // Create at 0600 so the key is never observable at wider permissions; the
    // follow-up chmod tightens pre-existing files and must not fail silently.
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        f.write_all(key)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, key).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    Ok(())
}

fn load_key_file(workspace_id: &str, app_data_dir: &Path) -> Result<[u8; 32], VoleeoError> {
    let path = key_file_path(workspace_id, app_data_dir)?;
    let bytes = std::fs::read(&path).map_err(|_| {
        VoleeoError::Crypto(format!(
            "workspace key not found for workspace '{workspace_id}' — \
             re-import your backup key"
        ))
    })?;
    if bytes.len() != 32 {
        return Err(VoleeoError::Crypto(
            "corrupt key file: expected 32 bytes".into(),
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn delete_key_file(workspace_id: &str, app_data_dir: &Path) {
    if let Ok(path) = key_file_path(workspace_id, app_data_dir) {
        let _ = std::fs::remove_file(path);
    }
}

/// Store the key in the OS keychain AND always write a 0600 keyfile backup.
///
/// Both are written so the keyfile fallback is always available — the keychain
/// entry can become inaccessible between restarts (e.g. app re-signing in dev),
/// which would make the key permanently unrecoverable if we only used the keychain.
pub fn save_key(
    workspace_id: &str,
    key: &[u8; 32],
    app_data_dir: &Path,
) -> Result<(), VoleeoError> {
    let hex = to_hex(key);
    // Best-effort keychain write; ignore failures.
    let _ = keyring_entry(workspace_id).and_then(|e| e.set_password(&hex));
    save_key_to_file(workspace_id, key, app_data_dir)?;
    Ok(())
}

/// Load the key from the key file only (no keychain access).
///
/// Prefer this in headless / background contexts where the OS keychain may
/// block waiting for user authorization that never arrives. `save_key` always
/// writes the key file as a reliable fallback, so this is safe to use.
pub fn load_key_from_file(
    workspace_id: &str,
    app_data_dir: &Path,
) -> Result<[u8; 32], VoleeoError> {
    load_key_file(workspace_id, app_data_dir)
}

/// Load the key from the OS keychain; fall back to the key file.
pub fn load_key(workspace_id: &str, app_data_dir: &Path) -> Result<[u8; 32], VoleeoError> {
    if let Ok(entry) = keyring_entry(workspace_id) {
        if let Ok(hex) = entry.get_password() {
            let bytes = from_hex(&hex)?;
            if bytes.len() != 32 {
                return Err(VoleeoError::Crypto(
                    "corrupt keyring entry: expected 32-byte hex".into(),
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    load_key_file(workspace_id, app_data_dir)
}

/// Delete the key from both the OS keychain and the key file.
pub fn delete_key(workspace_id: &str, app_data_dir: &Path) {
    if let Ok(entry) = keyring_entry(workspace_id) {
        let _ = entry.delete_credential();
    }
    delete_key_file(workspace_id, app_data_dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn generate_key_is_32_bytes_and_nonzero() {
        let key = generate_key();
        // Astronomically unlikely to be all zeros from a CSPRNG.
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn generate_key_two_calls_differ() {
        assert_ne!(generate_key(), generate_key());
    }

    #[test]
    fn encode_key_display_format() {
        let key = [0u8; 32];
        let display = encode_key_display(&key);
        // 64 hex chars + 7 dashes = 71 chars total.
        assert_eq!(display.len(), 71);
        let groups: Vec<&str> = display.split('-').collect();
        assert_eq!(groups.len(), 8);
        assert!(groups.iter().all(|g| g.len() == 8));
    }

    #[test]
    fn encode_decode_roundtrip() {
        let key = generate_key();
        assert_eq!(decode_key_display(&encode_key_display(&key)).unwrap(), key);
    }

    #[test]
    fn decode_key_display_case_insensitive() {
        let key = generate_key();
        let lower = encode_key_display(&key).to_lowercase();
        assert_eq!(decode_key_display(&lower).unwrap(), key);
    }

    #[test]
    fn decode_key_display_ignores_dashes_and_spaces() {
        let key = [0xABu8; 32];
        let raw = "AB".repeat(32); // 64 chars, no dashes
        assert_eq!(decode_key_display(&raw).unwrap(), key);
        assert_eq!(decode_key_display(&format!(" {} ", raw)).unwrap(), key);
    }

    #[test]
    fn decode_key_display_wrong_length_fails() {
        assert!(decode_key_display("DEADBEEF").is_err());
        assert!(decode_key_display(&"AA".repeat(33)).is_err());
    }

    #[test]
    fn decode_key_display_invalid_hex_fails() {
        assert!(decode_key_display(&"ZZ".repeat(32)).is_err());
    }

    #[test]
    fn save_and_load_from_file_roundtrip() {
        let dir = tmp();
        let key = generate_key();
        save_key("ws1", &key, dir.path()).unwrap();
        assert_eq!(load_key_from_file("ws1", dir.path()).unwrap(), key);
    }

    #[test]
    fn traversal_workspace_id_is_rejected() {
        let dir = tmp();
        assert!(save_key("../evil", &generate_key(), dir.path()).is_err());
        assert!(load_key_from_file("../evil", dir.path()).is_err());
        assert!(load_key_from_file("a/b", dir.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn key_file_is_created_0600() {
        let dir = tmp();
        save_key("ws1", &generate_key(), dir.path()).unwrap();
        let mode = std::fs::metadata(dir.path().join("keys/ws1.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn load_from_file_missing_returns_error() {
        let dir = tmp();
        assert!(load_key_from_file("nonexistent", dir.path()).is_err());
    }

    #[test]
    fn load_from_file_corrupt_size_returns_error() {
        let dir = tmp();
        let keys_dir = dir.path().join("keys");
        std::fs::create_dir_all(&keys_dir).unwrap();
        std::fs::write(keys_dir.join("ws1.key"), b"too short").unwrap();
        assert!(load_key_from_file("ws1", dir.path()).is_err());
    }

    #[test]
    fn delete_key_removes_file() {
        let dir = tmp();
        let key = generate_key();
        save_key("ws1", &key, dir.path()).unwrap();
        assert!(load_key_from_file("ws1", dir.path()).is_ok());
        delete_key("ws1", dir.path());
        assert!(load_key_from_file("ws1", dir.path()).is_err());
    }

    #[test]
    fn delete_key_is_idempotent() {
        let dir = tmp();
        // Should not panic when called on a workspace that has no key.
        delete_key("ghost", dir.path());
    }

    #[test]
    fn keys_are_isolated_per_workspace() {
        let dir = tmp();
        let key_a = generate_key();
        let key_b = generate_key();
        save_key("ws_a", &key_a, dir.path()).unwrap();
        save_key("ws_b", &key_b, dir.path()).unwrap();
        assert_eq!(load_key_from_file("ws_a", dir.path()).unwrap(), key_a);
        assert_eq!(load_key_from_file("ws_b", dir.path()).unwrap(), key_b);
    }
}
