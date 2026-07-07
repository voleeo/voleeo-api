use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{new_workspace_id, AuthConfig, RequestParameter, VoleeoError, Workspace};

fn default_workspace_headers() -> Vec<RequestParameter> {
    vec![
        RequestParameter {
            id: "default-user-agent".to_string(),
            name: "User-Agent".to_string(),
            value: "voleeo".to_string(),
            enabled: true,
        },
        RequestParameter {
            id: "default-accept".to_string(),
            name: "Accept".to_string(),
            value: "*/*".to_string(),
            enabled: true,
        },
    ]
}

#[derive(Clone)]
pub struct WorkspaceStore {
    dir: PathBuf,
}

impl WorkspaceStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let dir = app_data_dir.as_ref().join("workspaces");
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self { dir })
    }

    fn workspace_dir(&self, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(id)?;
        Ok(self.dir.join(id))
    }

    fn file_path(&self, id: &str) -> Result<PathBuf, VoleeoError> {
        Ok(self.workspace_dir(id)?.join("workspace.yaml"))
    }

    pub fn list(&self) -> Result<Vec<Workspace>, VoleeoError> {
        let mut workspaces = Vec::new();
        let entries =
            std::fs::read_dir(&self.dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let yaml_path = entry.path().join("workspace.yaml");
            if !yaml_path.exists() {
                continue;
            }
            let content = match std::fs::read_to_string(&yaml_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(ws) = serde_yaml::from_str::<Workspace>(&content) {
                workspaces.push(ws);
            }
        }
        workspaces.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(workspaces)
    }

    pub fn get(&self, id: &str) -> Result<Workspace, VoleeoError> {
        let content = std::fs::read_to_string(self.file_path(id)?)
            .map_err(|_| VoleeoError::NotFound(format!("workspace '{id}'")))?;
        serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    pub fn create(&self, name: String, encrypted: bool) -> Result<Workspace, VoleeoError> {
        let id = new_workspace_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let ws = Workspace {
            id: id.clone(),
            name,
            model: "workspace".to_string(),
            encrypted,
            sync_dir: None,
            key_check: None,
            headers: default_workspace_headers(),
            auth: AuthConfig::None,
            dns_overrides: vec![],
            created_at: now.clone(),
            updated_at: now,
        };
        std::fs::create_dir_all(self.workspace_dir(&id)?)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let content =
            serde_yaml::to_string(&ws).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(self.file_path(&id)?, content)?;
        Ok(ws)
    }

    pub fn save(&self, ws: &Workspace) -> Result<(), VoleeoError> {
        std::fs::create_dir_all(self.workspace_dir(&ws.id)?)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let content = serde_yaml::to_string(ws).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(self.file_path(&ws.id)?, content)
    }

    pub fn update_headers(
        &self,
        id: &str,
        headers: Vec<voleeo_core::RequestParameter>,
    ) -> Result<(), VoleeoError> {
        let mut ws = self.get(id)?;
        ws.headers = headers;
        ws.updated_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        self.save(&ws)
    }

    pub fn update_auth(&self, id: &str, auth: AuthConfig) -> Result<(), VoleeoError> {
        let mut ws = self.get(id)?;
        ws.auth = auth;
        ws.updated_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        self.save(&ws)
    }

    pub fn update_dns_overrides(
        &self,
        id: &str,
        overrides: Vec<voleeo_core::DnsOverride>,
    ) -> Result<(), VoleeoError> {
        let mut ws = self.get(id)?;
        ws.dns_overrides = overrides;
        ws.updated_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        self.save(&ws)
    }

    /// Remove the entire workspace folder (requests, folders, keyfile, metadata).
    pub fn delete(&self, id: &str) -> Result<(), VoleeoError> {
        let dir = self.workspace_dir(id)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_persists_and_get_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        let ws = store.create("My WS".into(), false).unwrap();
        assert_eq!(ws.name, "My WS");
        assert!(!ws.encrypted);
        let loaded = store.get(&ws.id).unwrap();
        assert_eq!(loaded.id, ws.id);
        assert_eq!(loaded.name, ws.name);
    }

    #[test]
    fn get_returns_not_found_for_unknown_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        let err = store.get("nonexistent").unwrap_err();
        assert!(matches!(err, VoleeoError::NotFound(_)));
    }

    #[test]
    fn list_returns_workspaces_sorted_by_created_at() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        let a = store.create("A".into(), false).unwrap();
        let b = store.create("B".into(), false).unwrap();
        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
        // created_at is ISO-8601; lexicographic order == chronological.
        assert!(list[0].created_at <= list[1].created_at);
        assert!(list.iter().any(|w| w.id == a.id));
        assert!(list.iter().any(|w| w.id == b.id));
    }

    #[test]
    fn list_skips_files_without_workspace_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        // A dir entry with no workspace.yaml should be skipped.
        let stray = dir.path().join("workspaces").join("stray");
        std::fs::create_dir_all(&stray).unwrap();
        let list = store.list().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn save_updates_existing_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        let mut ws = store.create("Old".into(), false).unwrap();
        ws.name = "New".into();
        store.save(&ws).unwrap();
        let loaded = store.get(&ws.id).unwrap();
        assert_eq!(loaded.name, "New");
    }

    #[test]
    fn delete_removes_workspace_dir() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        let ws = store.create("To Delete".into(), false).unwrap();
        store.delete(&ws.id).unwrap();
        assert!(matches!(
            store.get(&ws.id).unwrap_err(),
            VoleeoError::NotFound(_)
        ));
    }

    #[test]
    fn delete_is_idempotent_for_missing_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path()).unwrap();
        store.delete("ghost").unwrap();
    }
}
