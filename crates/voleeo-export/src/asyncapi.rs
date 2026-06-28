//! WebSocket connections → AsyncAPI 2.6 (one document per workspace). Best-effort:
//! Voleeo WS messages are freeform, so each channel carries the endpoint with a
//! generic message payload rather than a real schema.

use serde_json::{json, Map, Value};
use voleeo_core::VoleeoError;

use crate::{Bundle, ExportResult};

pub fn to_asyncapi(b: &Bundle) -> Result<ExportResult, VoleeoError> {
    let mut servers = Map::new();
    let mut channels = Map::new();

    for (i, ws) in b.ws.iter().enumerate() {
        let (protocol, host, path) = split_ws_url(&ws.url);
        let server_key = sanitize(&host).unwrap_or_else(|| format!("server{i}"));
        servers
            .entry(server_key)
            .or_insert(json!({ "url": host, "protocol": protocol }));

        let op = json!({
            "operationId": sanitize(&ws.name).unwrap_or_else(|| format!("op{i}")),
            "summary": ws.name,
            "message": { "payload": { "type": "object" } },
        });
        let channel = if path.is_empty() {
            "/".to_string()
        } else {
            path
        };
        channels.insert(
            channel,
            json!({ "description": ws.name, "subscribe": op.clone(), "publish": op }),
        );
    }

    let spec = json!({
        "asyncapi": "2.6.0",
        "info": {
            "title": format!("{} WebSockets", b.workspace.name),
            "version": "1.0.0",
        },
        "servers": Value::Object(servers),
        "channels": Value::Object(channels),
    });

    Ok(ExportResult {
        content: serde_yaml::to_string(&spec).map_err(|e| VoleeoError::Storage(e.to_string()))?,
        warnings: Vec::new(),
    })
}

/// `wss://host:port/path?query` → (`"wss"`, `"host:port"`, `"/path"`).
fn split_ws_url(url: &str) -> (String, String, String) {
    let (scheme, rest) = url.split_once("://").unwrap_or(("wss", url));
    let protocol = if scheme.eq_ignore_ascii_case("ws") {
        "ws"
    } else {
        "wss"
    };
    let rest = rest.split('?').next().unwrap_or(rest);
    let (host, path) = match rest.find('/') {
        Some(i) => (rest[..i].to_string(), rest[i..].to_string()),
        None => (rest.to_string(), String::new()),
    };
    (protocol.to_string(), host, path)
}

/// A non-empty identifier from arbitrary text (non-alphanumerics → `_`).
fn sanitize(s: &str) -> Option<String> {
    let out: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    let out = out.trim_matches('_').to_string();
    (!out.is_empty()).then_some(out)
}
