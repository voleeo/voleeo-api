//! `WsStore` — the `ws_{id}.yaml` files for one workspace. WebSocket connections
//! live alongside `req_*`/`folder_*` in the same workspace directory and share
//! the tree's `order` space, but get their own store so request CRUD stays put.

use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, AuthConfig, RequestParameter, VoleeoError, WsConnection};

fn now_ts() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string()
}

/// Persist only when a field changed vs `original`, bumping `updated_at` in that
/// case — mirrors `save_request_if_changed` to avoid phantom `updatedAt` diffs.
fn save_if_changed(
    path: &Path,
    original: &WsConnection,
    mut next: WsConnection,
) -> Result<(), VoleeoError> {
    next.updated_at = original.updated_at.clone();
    if next == *original {
        return Ok(());
    }
    next.updated_at = now_ts();
    let content = serde_yaml::to_string(&next).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
}

/// Manages `ws_*.yaml` files at `{app_data_dir}/workspaces/{workspace_id}/`.
#[derive(Clone)]
pub struct WsStore {
    workspaces_dir: PathBuf,
}

impl WsStore {
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

    fn ws_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("ws_{id}.yaml")))
    }

    pub fn get(&self, workspace_id: &str, id: &str) -> Result<WsConnection, VoleeoError> {
        let path = self.ws_path(workspace_id, id)?;
        if !path.exists() {
            return Err(VoleeoError::NotFound(format!("connection {id}")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let conn: WsConnection =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        if conn.id != id {
            return Err(VoleeoError::Storage(format!(
                "connection file id mismatch for {id}"
            )));
        }
        Ok(conn)
    }

    pub fn list(&self, workspace_id: &str) -> Result<Vec<WsConnection>, VoleeoError> {
        let dir = self.workspace_dir(workspace_id)?;
        let mut items = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("ws_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let conn: WsConnection =
                serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            items.push(conn);
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
        url: String,
    ) -> Result<WsConnection, VoleeoError> {
        self.workspace_dir(&workspace_id)?;
        let id = new_id();
        let now = now_ts();
        let order = Utc::now().timestamp_millis() as f64;
        let conn = WsConnection {
            id: id.clone(),
            connection_type: "api".to_string(),
            model: "ws_connection".to_string(),
            workspace_id: workspace_id.clone(),
            folder_id,
            name,
            url,
            parameters: vec![],
            headers: vec![],
            auth: AuthConfig::None,
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&conn).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.ws_path(&workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(conn)
    }

    /// Write a connection verbatim — id/order/folder/auth set by the caller.
    /// Used by native (Voleeo Bundle) import to land a connection in one pass.
    pub fn save(&self, conn: &WsConnection) -> Result<(), VoleeoError> {
        self.workspace_dir(&conn.workspace_id)?;
        let path = self.ws_path(&conn.workspace_id, &conn.id)?;
        let content =
            serde_yaml::to_string(conn).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    /// Smallest `ws_` sibling order strictly greater than `after`; midpoint
    /// places a duplicate directly below the original. Considers only WS
    /// siblings — interleaved requests sort correctly at display time anyway.
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

    pub fn duplicate(&self, workspace_id: &str, id: &str) -> Result<WsConnection, VoleeoError> {
        let src = self.get(workspace_id, id)?;
        let order = self.order_after(workspace_id, src.folder_id.as_deref(), src.order)?;
        let new = new_id();
        let now = now_ts();
        let conn = WsConnection {
            id: new.clone(),
            name: format!("Copy of {}", src.name),
            order,
            created_at: now.clone(),
            updated_at: now,
            ..src
        };
        let content =
            serde_yaml::to_string(&conn).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.ws_path(workspace_id, &new)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(conn)
    }

    pub fn rename(&self, workspace_id: &str, id: &str, name: String) -> Result<(), VoleeoError> {
        let current = self.get(workspace_id, id)?;
        let next = WsConnection {
            name,
            ..current.clone()
        };
        save_if_changed(&self.ws_path(workspace_id, id)?, &current, next)
    }

    pub fn update(
        &self,
        workspace_id: &str,
        id: &str,
        url: String,
        parameters: Vec<RequestParameter>,
        headers: Vec<RequestParameter>,
        auth: AuthConfig,
    ) -> Result<(), VoleeoError> {
        let current = self.get(workspace_id, id)?;
        let next = WsConnection {
            url,
            parameters,
            headers,
            auth,
            ..current.clone()
        };
        save_if_changed(&self.ws_path(workspace_id, id)?, &current, next)
    }

    pub fn delete(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let path = self.ws_path(workspace_id, id)?;
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
        let next = WsConnection {
            folder_id,
            order,
            ..current.clone()
        };
        save_if_changed(&self.ws_path(workspace_id, id)?, &current, next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> WsStore {
        WsStore::new(dir.path()).unwrap()
    }

    fn mk(s: &WsStore, ws: &str) -> WsConnection {
        s.create(ws.into(), None, "Socket".into(), "wss://example.com".into())
            .unwrap()
    }

    #[test]
    fn create_get_list() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let c = mk(&s, "ws1");
        assert_eq!(s.get("ws1", &c.id).unwrap().url, "wss://example.com");
        assert_eq!(s.list("ws1").unwrap().len(), 1);
        assert_eq!(c.model, "ws_connection");
    }

    #[test]
    fn list_ignores_requests_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        mk(&s, "ws1");
        // A stray req_ file must not be parsed as a connection.
        std::fs::write(
            dir.path().join("workspaces").join("ws1").join("req_x.yaml"),
            "id: x\n",
        )
        .unwrap();
        assert_eq!(s.list("ws1").unwrap().len(), 1);
    }

    #[test]
    fn duplicate_below_original() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let c = mk(&s, "ws1");
        let copy = s.duplicate("ws1", &c.id).unwrap();
        assert_eq!(copy.name, format!("Copy of {}", c.name));
        assert_ne!(copy.id, c.id);
        assert!(copy.order > c.order);
    }

    #[test]
    fn update_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let c = mk(&s, "ws1");
        let p = RequestParameter {
            id: "p1".into(),
            name: "token".into(),
            value: "abc".into(),
            enabled: true,
        };
        s.update(
            "ws1",
            &c.id,
            "wss://new.example.com".into(),
            vec![p.clone()],
            vec![],
            AuthConfig::None,
        )
        .unwrap();
        let loaded = s.get("ws1", &c.id).unwrap();
        assert_eq!(loaded.url, "wss://new.example.com");
        assert_eq!(loaded.parameters, vec![p]);
        s.delete("ws1", &c.id).unwrap();
        assert!(matches!(
            s.get("ws1", &c.id).unwrap_err(),
            VoleeoError::NotFound(_)
        ));
    }
}
