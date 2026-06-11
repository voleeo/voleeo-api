//! Per-request unary gRPC response history at
//! `{app_data_dir}/responses-local/{workspace_id}/grpc_resp_{request_id}.yaml`.
//! Newest-first `Vec<StoredGrpcResponse>`, trimmed to `limit`. gRPC bodies are
//! JSON and bounded, so unlike `ResponseStore` there is no out-of-line
//! windowing — entries stay inline.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, GrpcResponse, VoleeoError};

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredGrpcResponse {
    pub id: String,
    pub workspace_id: String,
    pub request_id: String,
    pub recorded_at: String,
    pub response: GrpcResponse,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredGrpcResponseSummary {
    pub id: String,
    pub request_id: String,
    pub recorded_at: String,
    pub status_code: i32,
    pub status_message: String,
    pub total_ms: f64,
}

#[derive(Clone)]
pub struct GrpcResponseStore {
    responses_local_dir: PathBuf,
}

impl GrpcResponseStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let responses_local_dir = app_data_dir.as_ref().join("responses-local");
        std::fs::create_dir_all(&responses_local_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            responses_local_dir,
        })
    }

    fn file_path(&self, workspace_id: &str, request_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(request_id)?;
        Ok(self
            .responses_local_dir
            .join(workspace_id)
            .join(format!("grpc_resp_{request_id}.yaml")))
    }

    fn read_all(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<Vec<StoredGrpcResponse>, VoleeoError> {
        let path = self.file_path(workspace_id, request_id)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(serde_yaml::from_str(&content).unwrap_or_default())
    }

    fn write_all(
        &self,
        workspace_id: &str,
        request_id: &str,
        items: &[StoredGrpcResponse],
    ) -> Result<(), VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let path = self.file_path(workspace_id, request_id)?;
        let content =
            serde_yaml::to_string(items).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(&path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    /// Prepend `response` to the history ring, trimming to `limit`. `limit = 0`
    /// is a no-op (returns the entry with a fresh id but stores nothing).
    pub fn append(
        &self,
        workspace_id: &str,
        request_id: &str,
        mut response: GrpcResponse,
        limit: usize,
    ) -> Result<StoredGrpcResponse, VoleeoError> {
        let id = new_id();
        response.response_id = id.clone();
        let recorded_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let stored = StoredGrpcResponse {
            id,
            workspace_id: workspace_id.to_string(),
            request_id: request_id.to_string(),
            recorded_at,
            response,
        };
        if limit == 0 {
            return Ok(stored);
        }
        let mut items = self.read_all(workspace_id, request_id)?;
        items.insert(0, stored.clone());
        items.truncate(limit);
        self.write_all(workspace_id, request_id, &items)?;
        Ok(stored)
    }

    pub fn list(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<Vec<StoredGrpcResponseSummary>, VoleeoError> {
        Ok(self
            .read_all(workspace_id, request_id)?
            .into_iter()
            .map(|r| StoredGrpcResponseSummary {
                id: r.id,
                request_id: r.request_id,
                recorded_at: r.recorded_at,
                status_code: r.response.status_code,
                status_message: r.response.status_message,
                total_ms: r.response.total_ms,
            })
            .collect())
    }

    pub fn get(
        &self,
        workspace_id: &str,
        request_id: &str,
        response_id: &str,
    ) -> Result<Option<StoredGrpcResponse>, VoleeoError> {
        Ok(self
            .read_all(workspace_id, request_id)?
            .into_iter()
            .find(|r| r.id == response_id))
    }

    pub fn clear(&self, workspace_id: &str, request_id: &str) -> Result<(), VoleeoError> {
        let path = self.file_path(workspace_id, request_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(req: &str) -> GrpcResponse {
        GrpcResponse {
            request_id: req.into(),
            status_code: 0,
            status_message: "OK".into(),
            message: r#"{"greeting":"hi"}"#.into(),
            metadata: vec![],
            trailers: vec![],
            total_ms: 5.0,
            events: vec![],
            response_id: String::new(),
        }
    }

    #[test]
    fn ring_buffer_trims() {
        let dir = tempfile::tempdir().unwrap();
        let s = GrpcResponseStore::new(dir.path()).unwrap();
        for _ in 0..12 {
            s.append("ws", "r1", resp("r1"), 10).unwrap();
        }
        assert_eq!(s.list("ws", "r1").unwrap().len(), 10);
    }

    #[test]
    fn get_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let s = GrpcResponseStore::new(dir.path()).unwrap();
        let stored = s.append("ws", "r1", resp("r1"), 5).unwrap();
        assert!(s.get("ws", "r1", &stored.id).unwrap().is_some());
        s.clear("ws", "r1").unwrap();
        assert_eq!(s.list("ws", "r1").unwrap().len(), 0);
    }
}
