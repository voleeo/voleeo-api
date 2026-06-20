use std::sync::Arc;

use subtle::ConstantTimeEq;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::RwLock;

use crate::api::ApiBackend;
use crate::protocol::{JsonRpcRequest, JsonRpcResponse, ToolResult};

/// Start the Unix socket MCP server. Accepts connections, authenticates via
/// a token on the first line, then handles JSON-RPC 2.0 (MCP protocol) messages.
///
/// The server runs even when MCP is disabled — `enabled` is checked per-request
/// so connected clients receive a clear error instead of a connection-refused
/// that would cause infinite retry loops in the bridge.
pub async fn run(
    socket_path: std::path::PathBuf,
    backend: Arc<ApiBackend>,
    token: Arc<RwLock<Option<String>>>,
    enabled: Arc<RwLock<bool>>,
) {
    // Remove stale socket from a previous run.
    let _ = std::fs::remove_file(&socket_path);

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mcp] failed to bind socket {}: {e}", socket_path.display());
            return;
        }
    };

    // Restrict socket to owner only on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600));
    }

    eprintln!("[mcp] listening on {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let backend = backend.clone();
                let token = token.clone();
                let enabled = enabled.clone();
                tokio::spawn(async move {
                    handle_connection(stream, backend, token, enabled).await;
                });
            }
            Err(e) => eprintln!("[mcp] accept error: {e}"),
        }
    }
}

async fn handle_connection(
    stream: tokio::net::UnixStream,
    backend: Arc<ApiBackend>,
    token: Arc<RwLock<Option<String>>>,
    enabled: Arc<RwLock<bool>>,
) {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);

    // ── Auth handshake ─────────────────────────────────────────────────────
    // Timeout prevents a silent client from holding the task open indefinitely.
    let mut line = String::new();
    let n = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_line(&mut line),
    )
    .await
    {
        Ok(Ok(n)) => n,
        Ok(Err(_)) | Err(_) => return, // I/O error or timed out
    };
    if n == 0 {
        return;
    }
    let presented = line.trim();
    let expected = token.read().await;
    // Constant-time compare so a timing side channel can't reveal the token
    // prefix byte by byte (length still leaks, which is unavoidable here).
    let ok = expected
        .as_ref()
        .map(|t| bool::from(t.as_bytes().ct_eq(presented.as_bytes())))
        .unwrap_or(false);
    drop(expected);
    if !ok {
        let _ = writer.write_all(b"ERR invalid token\n").await;
        return;
    }
    let _ = writer.write_all(b"OK\n").await;

    // ── JSON-RPC message loop ──────────────────────────────────────────────
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_enabled = *enabled.read().await;
        if let Some(resp) = dispatch(&backend, trimmed, is_enabled).await {
            match serde_json::to_string(&resp) {
                Ok(s) => {
                    if writer.write_all(format!("{s}\n").as_bytes()).await.is_err() {
                        break;
                    }
                }
                Err(e) => eprintln!("[mcp] serialize error: {e}"),
            }
        }
    }
}

async fn dispatch(backend: &ApiBackend, raw: &str, enabled: bool) -> Option<JsonRpcResponse> {
    let req: JsonRpcRequest = match serde_json::from_str(raw) {
        Ok(r) => r,
        Err(e) => {
            return Some(JsonRpcResponse::err(
                None,
                -32700,
                format!("parse error: {e}"),
            ))
        }
    };

    // Notifications have no id and must not receive a response.
    req.id.as_ref()?;

    let id = req.id.clone();

    Some(match req.method.as_str() {
        // Protocol-level methods always respond so the bridge stays connected.
        "initialize" => JsonRpcResponse::ok(
            id,
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "voleeo", "version": env!("CARGO_PKG_VERSION") }
            }),
        ),

        "ping" => JsonRpcResponse::ok(id, serde_json::json!({})),

        // Tool methods are gated on the enabled flag.
        "tools/list" => {
            if !enabled {
                return Some(disabled_error(id));
            }
            let tools = backend.tools();
            JsonRpcResponse::ok(id, serde_json::json!({ "tools": tools }))
        }

        "tools/call" => {
            if !enabled {
                return Some(disabled_error(id));
            }
            let name = match req.params["name"].as_str() {
                Some(n) => n.to_string(),
                None => return Some(JsonRpcResponse::err(id, -32602, "missing tool name")),
            };
            let args = req.params["arguments"].clone();
            let result: ToolResult = backend.call_tool(&name, args).await;
            match serde_json::to_value(&result) {
                Ok(v) => JsonRpcResponse::ok(id, v),
                Err(e) => JsonRpcResponse::err(id, -32603, e.to_string()),
            }
        }

        method => JsonRpcResponse::err(id, -32601, format!("method not found: {method}")),
    })
}

fn disabled_error(id: Option<serde_json::Value>) -> JsonRpcResponse {
    JsonRpcResponse::err(
        id,
        -32000,
        "MCP Bridge is disabled. Please enable it in Voleeo (gear menu → MCP Bridge).",
    )
}
