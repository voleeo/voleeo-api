//! `GrpcStore` — the `grpc_{id}.yaml` files for one workspace. gRPC requests
//! live alongside `req_*`/`ws_*`/`folder_*` in the same workspace directory and
//! share the tree's `order` space. Mirrors `WsStore`.

use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, AuthConfig, GrpcRequest, ProtoSource, RequestParameter, VoleeoError};

fn now_ts() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string()
}

/// Persist only when a field changed vs `original`, bumping `updated_at` in that
/// case — avoids phantom `updatedAt` diffs (mirrors `save_request_if_changed`).
fn save_if_changed(
    path: &Path,
    original: &GrpcRequest,
    mut next: GrpcRequest,
) -> Result<(), VoleeoError> {
    next.updated_at = original.updated_at.clone();
    if next == *original {
        return Ok(());
    }
    next.updated_at = now_ts();
    let content = serde_yaml::to_string(&next).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
}

/// Fields a gRPC request update can change (everything but identity/timestamps).
pub struct GrpcUpdate {
    pub target: String,
    pub tls: bool,
    pub proto_source: ProtoSource,
    pub service: Option<String>,
    pub method: Option<String>,
    pub metadata: Vec<RequestParameter>,
    pub message: String,
    pub auth: AuthConfig,
}

/// Manages `grpc_*.yaml` files at `{app_data_dir}/workspaces/{workspace_id}/`.
#[derive(Clone)]
pub struct GrpcStore {
    workspaces_dir: PathBuf,
}

impl GrpcStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let workspaces_dir = app_data_dir.as_ref().join("workspaces");
        std::fs::create_dir_all(&workspaces_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self { workspaces_dir })
    }

    fn workspace_dir(&self, workspace_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.workspaces_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(dir)
    }

    fn grpc_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("grpc_{id}.yaml")))
    }

    pub fn get(&self, workspace_id: &str, id: &str) -> Result<GrpcRequest, VoleeoError> {
        let path = self.grpc_path(workspace_id, id)?;
        if !path.exists() {
            return Err(VoleeoError::NotFound(format!("grpc request {id}")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let req: GrpcRequest =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        if req.id != id {
            return Err(VoleeoError::Storage(format!(
                "grpc file id mismatch for {id}"
            )));
        }
        Ok(req)
    }

    pub fn list(&self, workspace_id: &str) -> Result<Vec<GrpcRequest>, VoleeoError> {
        let dir = self.workspace_dir(workspace_id)?;
        let mut items = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("grpc_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let req: GrpcRequest =
                serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            items.push(req);
        }
        items.sort_by(|a, b| {
            a.order
                .partial_cmp(&b.order)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    pub fn create(
        &self,
        workspace_id: String,
        folder_id: Option<String>,
        name: String,
        target: String,
    ) -> Result<GrpcRequest, VoleeoError> {
        self.workspace_dir(&workspace_id)?;
        let id = new_id();
        let now = now_ts();
        let order = Utc::now().timestamp_millis() as f64;
        let req = GrpcRequest {
            id: id.clone(),
            request_type: "api".to_string(),
            model: "grpc_request".to_string(),
            workspace_id: workspace_id.clone(),
            folder_id,
            name,
            target,
            tls: false,
            proto_source: ProtoSource::default(),
            service: None,
            method: None,
            metadata: vec![],
            message: String::new(),
            auth: AuthConfig::None,
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&req).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.grpc_path(&workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(req)
    }

    /// Smallest `grpc_` sibling order strictly greater than `after`; midpoint
    /// places a duplicate directly below the original.
    fn order_after(
        &self,
        workspace_id: &str,
        parent_id: Option<&str>,
        after: f64,
    ) -> Result<f64, VoleeoError> {
        let mut next: Option<f64> = None;
        for c in self.list(workspace_id)? {
            if c.folder_id.as_deref() == parent_id && c.order > after {
                next = Some(next.map_or(c.order, |n| n.min(c.order)));
            }
        }
        Ok(next.map_or(after + 1.0, |n| (after + n) / 2.0))
    }

    pub fn duplicate(&self, workspace_id: &str, id: &str) -> Result<GrpcRequest, VoleeoError> {
        let src = self.get(workspace_id, id)?;
        let order = self.order_after(workspace_id, src.folder_id.as_deref(), src.order)?;
        let new = new_id();
        let now = now_ts();
        let req = GrpcRequest {
            id: new.clone(),
            name: format!("Copy of {}", src.name),
            order,
            created_at: now.clone(),
            updated_at: now,
            ..src
        };
        let content =
            serde_yaml::to_string(&req).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.grpc_path(workspace_id, &new)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(req)
    }

    pub fn rename(&self, workspace_id: &str, id: &str, name: String) -> Result<(), VoleeoError> {
        let current = self.get(workspace_id, id)?;
        let next = GrpcRequest {
            name,
            ..current.clone()
        };
        save_if_changed(&self.grpc_path(workspace_id, id)?, &current, next)
    }

    pub fn update(
        &self,
        workspace_id: &str,
        id: &str,
        update: GrpcUpdate,
    ) -> Result<(), VoleeoError> {
        let current = self.get(workspace_id, id)?;
        let next = GrpcRequest {
            target: update.target,
            tls: update.tls,
            proto_source: update.proto_source,
            service: update.service,
            method: update.method,
            metadata: update.metadata,
            message: update.message,
            auth: update.auth,
            ..current.clone()
        };
        save_if_changed(&self.grpc_path(workspace_id, id)?, &current, next)
    }

    pub fn delete(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let path = self.grpc_path(workspace_id, id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn update_position(
        &self,
        workspace_id: &str,
        id: &str,
        folder_id: Option<String>,
        order: f64,
    ) -> Result<(), VoleeoError> {
        let current = self.get(workspace_id, id)?;
        let next = GrpcRequest {
            folder_id,
            order,
            ..current.clone()
        };
        save_if_changed(&self.grpc_path(workspace_id, id)?, &current, next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> GrpcStore {
        GrpcStore::new(dir.path()).unwrap()
    }

    fn mk(s: &GrpcStore, ws: &str) -> GrpcRequest {
        s.create(ws.into(), None, "Call".into(), "localhost:50051".into())
            .unwrap()
    }

    #[test]
    fn create_get_list() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let c = mk(&s, "ws1");
        assert_eq!(s.get("ws1", &c.id).unwrap().target, "localhost:50051");
        assert_eq!(s.list("ws1").unwrap().len(), 1);
        assert_eq!(c.model, "grpc_request");
        assert_eq!(c.proto_source, ProtoSource::Reflection);
    }

    #[test]
    fn list_ignores_other_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        mk(&s, "ws1");
        std::fs::write(
            dir.path().join("workspaces").join("ws1").join("ws_x.yaml"),
            "id: x\n",
        )
        .unwrap();
        assert_eq!(s.list("ws1").unwrap().len(), 1);
    }

    #[test]
    fn update_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let c = mk(&s, "ws1");
        s.update(
            "ws1",
            &c.id,
            GrpcUpdate {
                target: "example.com:443".into(),
                tls: true,
                proto_source: ProtoSource::Reflection,
                service: Some("pkg.Svc".into()),
                method: Some("Call".into()),
                metadata: vec![],
                message: r#"{"x":1}"#.into(),
                auth: AuthConfig::None,
            },
        )
        .unwrap();
        let loaded = s.get("ws1", &c.id).unwrap();
        assert_eq!(loaded.target, "example.com:443");
        assert!(loaded.tls);
        assert_eq!(loaded.service.as_deref(), Some("pkg.Svc"));
        s.delete("ws1", &c.id).unwrap();
        assert!(matches!(
            s.get("ws1", &c.id).unwrap_err(),
            VoleeoError::NotFound(_)
        ));
    }
}
