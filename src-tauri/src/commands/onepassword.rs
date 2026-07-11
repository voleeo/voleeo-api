//! Resolves 1Password secret references through the `voleeo-1password-bridge`
//! sidecar, which talks to the 1Password desktop app via the official SDK
//! (biometric authorization). Authorization is bound to the bridge process, so
//! one long-lived child is spawned lazily and kept for the app's lifetime.
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use voleeo_core::error::VoleeoError;

/// `op://vault/item/[section/]field` — at least vault + item + field, no empty segments.
fn is_valid_ref(reference: &str) -> bool {
    let Some(path) = reference.strip_prefix("op://") else {
        return false;
    };
    let segments: Vec<&str> = path.split('/').collect();
    segments.len() >= 3 && segments.iter().all(|s| !s.trim().is_empty())
}

struct Bridge {
    // Held only so kill_on_drop reaps the child when the bridge is replaced.
    _child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

// tokio Mutex (held across await) — serializes reads through the bridge so at
// most one 1Password authorization prompt is in flight.
static BRIDGE: Mutex<Option<Bridge>> = Mutex::const_new(None);

#[derive(Serialize)]
struct BridgeRequest<'a> {
    id: u64,
    account: &'a str,
    r#ref: &'a str,
}

#[derive(Deserialize)]
struct BridgeResponse {
    id: u64,
    ok: bool,
    value: Option<String>,
    error: Option<String>,
    #[serde(default)]
    auth: bool,
}

fn bridge_command() -> Result<Command, VoleeoError> {
    // Dev builds skip externalBin (tauri.dev.conf.json) — run the TS source.
    #[cfg(debug_assertions)]
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| VoleeoError::InvalidConfig("workspace root not found".into()))?;
        let mut cmd = Command::new("bun");
        cmd.arg(root.join("plugins/1password/bridge/main.ts"));
        Ok(cmd)
    }
    #[cfg(not(debug_assertions))]
    {
        let exe = std::env::current_exe().map_err(|e| {
            VoleeoError::InvalidConfig(format!("cannot locate app executable: {e}"))
        })?;
        let dir = exe
            .parent()
            .ok_or_else(|| VoleeoError::InvalidConfig("app executable has no parent dir".into()))?;
        let path = dir.join(format!(
            "voleeo-1password-bridge{}",
            std::env::consts::EXE_SUFFIX
        ));
        if !path.exists() {
            return Err(VoleeoError::NotFound(
                "1Password bridge is missing from the app bundle".into(),
            ));
        }
        Ok(Command::new(path))
    }
}

async fn spawn_bridge() -> Result<Bridge, VoleeoError> {
    let mut child = bridge_command()?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            VoleeoError::InvalidConfig(format!("failed to start 1Password bridge: {e}"))
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| VoleeoError::InvalidConfig("bridge stdin unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| VoleeoError::InvalidConfig("bridge stdout unavailable".into()))?;
    Ok(Bridge {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout).lines(),
        next_id: 0,
    })
}

async fn roundtrip(
    bridge: &mut Bridge,
    account: &str,
    reference: &str,
) -> Result<BridgeResponse, VoleeoError> {
    bridge.next_id += 1;
    let id = bridge.next_id;
    let mut line = serde_json::to_string(&BridgeRequest {
        id,
        account,
        r#ref: reference,
    })
    .map_err(|e| VoleeoError::InvalidConfig(format!("bridge request encode: {e}")))?;
    line.push('\n');
    let io_err =
        |e: std::io::Error| VoleeoError::InvalidConfig(format!("1Password bridge died: {e}"));
    bridge
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(io_err)?;
    loop {
        let reply = bridge
            .stdout
            .next_line()
            .await
            .map_err(io_err)?
            .ok_or_else(|| VoleeoError::InvalidConfig("1Password bridge closed".into()))?;
        let resp: BridgeResponse = serde_json::from_str(&reply)
            .map_err(|e| VoleeoError::InvalidConfig(format!("bridge reply decode: {e}")))?;
        // Older ids are stragglers from a request that timed out — skip them.
        if resp.id == id {
            return Ok(resp);
        }
    }
}

async fn read_via_bridge(
    guard: &mut Option<Bridge>,
    account: &str,
    reference: &str,
) -> Result<BridgeResponse, VoleeoError> {
    if guard.is_none() {
        *guard = Some(spawn_bridge().await?);
    }
    let Some(bridge) = guard.as_mut() else {
        return Err(VoleeoError::InvalidConfig(
            "1Password bridge unavailable".into(),
        ));
    };
    roundtrip(bridge, account, reference).await
}

/// Biometric approval is human-paced; generous, but not forever.
const READ_TIMEOUT: Duration = Duration::from_secs(120);

/// Resolve a 1Password secret reference for `account`. Auth failures map to
/// `NotFound` so the frontend can re-prompt for the account name; the value is
/// returned to the caller and never logged or persisted.
#[tauri::command]
#[specta::specta]
pub async fn op_read(reference: String, account: String) -> Result<String, VoleeoError> {
    if !is_valid_ref(&reference) {
        return Err(VoleeoError::InvalidConfig(
            "invalid secret reference — expected op://vault/item/field".into(),
        ));
    }
    if account.trim().is_empty() {
        return Err(VoleeoError::InvalidConfig(
            "1Password account name is required".into(),
        ));
    }

    let mut guard = BRIDGE.lock().await;
    let had_bridge = guard.is_some();
    let attempt = tokio::time::timeout(
        READ_TIMEOUT,
        read_via_bridge(&mut guard, &account, &reference),
    )
    .await;
    let resp = match attempt {
        Err(_) => {
            // A timed-out bridge may still be mid-prompt; drop it so the next
            // read starts clean.
            *guard = None;
            return Err(VoleeoError::InvalidConfig(
                "timed out waiting for 1Password authorization".into(),
            ));
        }
        Ok(Ok(resp)) => resp,
        // A pre-existing bridge may be stale (e.g. killed externally) — respawn once.
        Ok(Err(_)) if had_bridge => {
            *guard = None;
            tokio::time::timeout(
                READ_TIMEOUT,
                read_via_bridge(&mut guard, &account, &reference),
            )
            .await
            .map_err(|_| {
                VoleeoError::InvalidConfig("timed out waiting for 1Password authorization".into())
            })??
        }
        Ok(Err(e)) => return Err(e),
    };

    if resp.ok {
        resp.value
            .ok_or_else(|| VoleeoError::InvalidConfig("bridge reply missing value".into()))
    } else {
        let msg = resp.error.unwrap_or_else(|| "1Password read failed".into());
        if resp.auth {
            Err(VoleeoError::NotFound(msg))
        } else {
            Err(VoleeoError::InvalidConfig(msg))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_valid_ref;

    #[test]
    fn validates_secret_references() {
        assert!(is_valid_ref("op://vault/item/field"));
        assert!(is_valid_ref("op://vault/item/section/field"));
        assert!(is_valid_ref("op://prod/db/one-time password?attribute=otp"));
        assert!(!is_valid_ref(""));
        assert!(!is_valid_ref("vault/item/field"));
        assert!(!is_valid_ref("op://vault/item"));
        assert!(!is_valid_ref("op://vault//field"));
        assert!(!is_valid_ref("op:// / / "));
    }
}
