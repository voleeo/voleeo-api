//! Debug-only entity inspection. Resolves a request/folder/WS/gRPC entity's
//! on-disk file path, metadata, and verbatim YAML for the Info modal, so we can
//! quickly find which file backs the selected item and see it as stored.

use std::path::Path;

use serde::Serialize;
use tauri::State;
use voleeo_core::VoleeoError;

use crate::state::AppState;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EntityDebugInfo {
    pub file_name: String,
    /// Logical path under the app data dir — `workspaces/{id}` may be a symlink.
    pub logical_path: String,
    /// Canonical path with symlinks resolved (where the bytes actually live).
    pub resolved_path: Option<String>,
    pub exists: bool,
    /// `f64` for JS-number / specta interop.
    pub size_bytes: f64,
    pub modified: Option<String>,
    /// Set when `workspaces/{id}` is a symlink to a user sync dir.
    pub sync_link_target: Option<String>,
    /// Machine-local response-history file (requests / gRPC only).
    pub response_file: Option<String>,
    /// The YAML file's verbatim on-disk content (secrets stay `enc:v1:` at rest —
    /// not decrypted). `None` when absent or larger than 1 MiB.
    pub file_content: Option<String>,
}

fn entity_file_name(kind: &str, id: &str) -> Option<String> {
    Some(match kind {
        "request" => format!("req_{id}.yaml"),
        "folder" => format!("folder_{id}.yaml"),
        "websocket" => format!("ws_{id}.yaml"),
        "grpc" => format!("grpc_{id}.yaml"),
        _ => return None,
    })
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[tauri::command]
#[specta::specta]
pub async fn debug_entity_info(
    state: State<'_, AppState>,
    workspace_id: String,
    kind: String,
    id: String,
) -> Result<EntityDebugInfo, VoleeoError> {
    if !valid_id(&workspace_id) || !valid_id(&id) {
        return Err(VoleeoError::InvalidConfig("invalid id".into()));
    }
    let file_name = entity_file_name(&kind, &id)
        .ok_or_else(|| VoleeoError::InvalidConfig(format!("unknown entity kind: {kind}")))?;
    let app = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || compute(&app, &workspace_id, &kind, &id, file_name))
        .await
        .map_err(|e| VoleeoError::Storage(e.to_string()))?
}

fn compute(
    app: &Path,
    workspace_id: &str,
    kind: &str,
    id: &str,
    file_name: String,
) -> Result<EntityDebugInfo, VoleeoError> {
    let ws_dir = app.join("workspaces").join(workspace_id);
    let logical = ws_dir.join(&file_name);

    let meta = std::fs::metadata(&logical).ok();
    let modified = meta.as_ref().and_then(|m| m.modified().ok()).map(|t| {
        let dt: chrono::DateTime<chrono::Utc> = t.into();
        dt.to_rfc3339()
    });

    // Verbatim YAML — secrets remain `enc:v1:` ciphertext (no decryption).
    let file_content = meta
        .as_ref()
        .filter(|m| m.len() <= 1024 * 1024)
        .and_then(|_| std::fs::read_to_string(&logical).ok());

    let response_file = match kind {
        "request" => Some(format!("req_{id}.yaml")),
        "grpc" => Some(format!("grpc_resp_{id}.yaml")),
        _ => None,
    }
    .map(|f| {
        app.join("responses-local")
            .join(workspace_id)
            .join(f)
            .display()
            .to_string()
    });

    Ok(EntityDebugInfo {
        file_name,
        logical_path: logical.display().to_string(),
        resolved_path: std::fs::canonicalize(&logical)
            .ok()
            .map(|p| p.display().to_string()),
        exists: meta.is_some(),
        size_bytes: meta.as_ref().map(|m| m.len() as f64).unwrap_or(0.0),
        modified,
        sync_link_target: crate::platform::read_link_target(&ws_dir)
            .ok()
            .map(|p| p.display().to_string()),
        response_file,
        file_content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_per_kind() {
        assert_eq!(entity_file_name("request", "abc").unwrap(), "req_abc.yaml");
        assert_eq!(
            entity_file_name("folder", "abc").unwrap(),
            "folder_abc.yaml"
        );
        assert_eq!(entity_file_name("websocket", "abc").unwrap(), "ws_abc.yaml");
        assert_eq!(entity_file_name("grpc", "abc").unwrap(), "grpc_abc.yaml");
        assert!(entity_file_name("bogus", "abc").is_none());
    }

    #[test]
    fn id_validation_blocks_traversal() {
        assert!(valid_id("req-123_AB"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }
}
