//! Thin stdio ↔ local-IPC bridge for the Voleeo MCP server.
//!
//! Claude Desktop / Claude Code spawns this binary per session. The bridge:
//!   1. Connects to the Voleeo app (Unix socket on macOS/Linux, named pipe on
//!      Windows) — retries with backoff.
//!   2. Sends the auth token on the first line.
//!   3. Checks the server's OK response.
//!   4. Relays stdin → socket and socket → stdout transparently.
//!   5. If the connection drops, reconnects automatically (app restart / hot-reload).
//!
//! Required env vars:
//!   VOLEEO_MCP_TOKEN  — auth token shown in Voleeo's gear menu › MCP Bridge.
//!
//! Optional env vars:
//!   VOLEEO_SOCKET_PATH — override the socket path / pipe name (default: platform standard).

use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

#[tokio::main]
async fn main() {
    let token = std::env::var("VOLEEO_MCP_TOKEN")
        .expect("VOLEEO_MCP_TOKEN environment variable is required");

    let socket_path = std::env::var("VOLEEO_SOCKET_PATH").unwrap_or_else(|_| default_socket_path());

    // Backoff only applies to ConnectError (can't reach socket at all).
    // After a clean disconnect we retry immediately — the socket is usually
    // back within milliseconds of an app restart.
    let mut connect_backoff = Duration::from_millis(500);

    loop {
        match try_session(&token, &socket_path).await {
            SessionResult::AuthFailed(msg) => {
                // Wrong token — retrying won't fix this.
                eprintln!("[voleeo-mcp-bridge] authentication failed: {msg}");
                eprintln!(
                    "[voleeo-mcp-bridge] Check VOLEEO_MCP_TOKEN matches the token in Voleeo."
                );
                std::process::exit(1);
            }
            SessionResult::Disconnected => {
                // Socket closed (app restarted, hot-reload). The socket is
                // usually recreated within milliseconds — retry quickly.
                eprintln!("[voleeo-mcp-bridge] connection lost — reconnecting…");
                connect_backoff = Duration::from_millis(500); // reset after a live session
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            SessionResult::ConnectError(e) => {
                eprintln!("[voleeo-mcp-bridge] failed to connect to {socket_path}: {e}");
                eprintln!(
                    "[voleeo-mcp-bridge] Is Voleeo running with MCP enabled? \
                     Retrying in {}ms…",
                    connect_backoff.as_millis()
                );
                tokio::time::sleep(connect_backoff).await;
                connect_backoff = (connect_backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

enum SessionResult {
    /// Auth succeeded, relay ran, then the socket closed — reconnect.
    Disconnected,
    /// Token was rejected — fatal, do not retry.
    AuthFailed(String),
    /// Could not reach the socket at all.
    ConnectError(std::io::Error),
}

async fn try_session(token: &str, socket_path: &str) -> SessionResult {
    #[cfg(unix)]
    let stream = {
        use tokio::net::UnixStream;
        match UnixStream::connect(socket_path).await {
            Ok(s) => s,
            Err(e) => return SessionResult::ConnectError(e),
        }
    };
    #[cfg(windows)]
    let stream = {
        use tokio::net::windows::named_pipe::ClientOptions;
        // A busy pipe surfaces as ConnectError → the outer loop backs off and retries.
        match ClientOptions::new().open(socket_path) {
            Ok(s) => s,
            Err(e) => return SessionResult::ConnectError(e),
        }
    };

    relay(stream, token).await
}

/// Auth handshake then transparent stdin↔stream relay. Generic over the
/// transport so Unix sockets and Windows named pipes share one code path.
async fn relay<S>(mut stream: S, token: &str) -> SessionResult
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    // Auth handshake: send token, read one-line response.
    if stream
        .write_all(format!("{token}\n").as_bytes())
        .await
        .is_err()
    {
        return SessionResult::Disconnected;
    }

    let mut auth_resp = Vec::new();
    loop {
        let mut byte = [0u8; 1];
        match stream.read_exact(&mut byte).await {
            Ok(_) => {
                if byte[0] == b'\n' {
                    break;
                }
                auth_resp.push(byte[0]);
            }
            Err(_) => return SessionResult::Disconnected,
        }
    }

    let resp = String::from_utf8_lossy(&auth_resp);
    if resp.trim() != "OK" {
        return SessionResult::AuthFailed(resp.into_owned());
    }

    // Relay stdin → socket and socket → stdout.
    //
    // IMPORTANT: use select! on the futures directly — do NOT tokio::spawn them.
    // spawn() detaches the task; dropping the JoinHandle leaves it running.
    // If the socket closes (t2), a detached t1 keeps consuming bytes from stdin
    // that the next session can never recover — the reconnect loop would start
    // a second stdin reader racing with the first, silently dropping MCP frames.
    //
    // By using select! on the futures inline, when one branch fires the other
    // future is dropped (cancelled) at its next await point, releasing stdin
    // cleanly so the reconnect loop can hand it to a fresh copy.
    let (mut socket_r, mut socket_w) = tokio::io::split(stream);
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();

    tokio::select! {
        _ = tokio::io::copy(&mut stdin, &mut socket_w) => {}
        _ = tokio::io::copy(&mut socket_r, &mut stdout) => {}
    }

    SessionResult::Disconnected
}

fn default_socket_path() -> String {
    // Mirror the path Tauri uses for app_data_dir: bundle_id as the folder name.
    // Bundle identifier is "com.voleeo.desktop" per tauri.conf.json.
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{home}/Library/Application Support/com.voleeo.desktop/mcp.sock")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{home}/.local/share/com.voleeo.desktop/mcp.sock")
    }
    #[cfg(target_os = "windows")]
    {
        voleeo_mcp::WINDOWS_PIPE_NAME.to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "./mcp.sock".into()
    }
}
