use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, CookieJar, VoleeoError};

/// Fixed id used for each workspace's auto-created default jar.
/// Bare (no `jar_` prefix) — the file-naming layer adds the `jar_` prefix, so
/// the file is `jar_default.yaml`, consistent with `req_`/`folder_`/`env_`.
pub const DEFAULT_JAR_ID: &str = "default";

/// Manages `jar_*.yaml` files for a single workspace.
///
/// All jars live under `{app_data_dir}/workspaces/{workspace_id}/`, so they are
/// included in workspace sync (when the workspace dir is symlinked to a sync
/// folder). Cookies inside a jar may carry encrypted values when the workspace
/// is encrypted — the encryption transform happens in the Tauri command layer,
/// not here.
#[derive(Clone)]
pub struct CookieJarStore {
    workspaces_dir: PathBuf,
}

impl CookieJarStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let workspaces_dir = app_data_dir.as_ref().join("workspaces");
        std::fs::create_dir_all(&workspaces_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self { workspaces_dir })
    }

    fn dir(&self, workspace_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.workspaces_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(dir)
    }

    fn path(&self, workspace_id: &str, jar_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(jar_id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("jar_{jar_id}.yaml")))
    }

    /// List all jars for a workspace, sorted by created_at. Returns at least
    /// one jar — creates `jar_default` on first call if the dir has none.
    pub fn list(&self, workspace_id: &str) -> Result<Vec<CookieJar>, VoleeoError> {
        let dir = self.dir(workspace_id)?;
        let mut jars: Vec<CookieJar> = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("jar_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let jar: CookieJar =
                serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            jars.push(jar);
        }
        if jars.is_empty() {
            jars.push(self.ensure_default(workspace_id)?);
        }
        jars.sort_by(|a, b| {
            // Default jar always first, then by creation time.
            let order = |j: &CookieJar| if j.id == DEFAULT_JAR_ID { 0 } else { 1 };
            order(a)
                .cmp(&order(b))
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(jars)
    }

    pub fn get(&self, workspace_id: &str, jar_id: &str) -> Result<CookieJar, VoleeoError> {
        let path = self.path(workspace_id, jar_id)?;
        if !path.exists() {
            if jar_id == DEFAULT_JAR_ID {
                return self.ensure_default(workspace_id);
            }
            return Err(VoleeoError::NotFound(format!("cookie jar '{jar_id}'")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    pub fn save(&self, jar: &CookieJar) -> Result<(), VoleeoError> {
        self.dir(&jar.workspace_id)?;
        let path = self.path(&jar.workspace_id, &jar.id)?;
        let content =
            serde_yaml::to_string(jar).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(&path, content)
    }

    /// Delete a jar. Refuses to delete the Default jar (the canonical fallback,
    /// auto-recreated by `ensure_default`) and refuses to delete the last
    /// remaining jar — a workspace must always keep at least one.
    pub fn delete(&self, workspace_id: &str, jar_id: &str) -> Result<(), VoleeoError> {
        if jar_id == DEFAULT_JAR_ID {
            return Err(VoleeoError::InvalidConfig(
                "cannot delete the Default cookie jar".to_string(),
            ));
        }
        if self.list(workspace_id)?.len() <= 1 {
            return Err(VoleeoError::InvalidConfig(
                "Workspace must keep at least one cookie jar".to_string(),
            ));
        }
        let path = self.path(workspace_id, jar_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    /// Ensure the default jar exists for the workspace. Idempotent.
    pub fn ensure_default(&self, workspace_id: &str) -> Result<CookieJar, VoleeoError> {
        let path = self.path(workspace_id, DEFAULT_JAR_ID)?;
        if path.exists() {
            let content =
                std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            return serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()));
        }
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let jar = CookieJar {
            id: DEFAULT_JAR_ID.to_string(),
            workspace_id: workspace_id.to_string(),
            name: "Default".to_string(),
            cookies: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.save(&jar)?;
        Ok(jar)
    }

    pub fn create(&self, workspace_id: String, name: String) -> Result<CookieJar, VoleeoError> {
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let jar = CookieJar {
            id: new_id(),
            workspace_id,
            name,
            cookies: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.save(&jar)?;
        Ok(jar)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> CookieJarStore {
        CookieJarStore::new(dir.path()).unwrap()
    }

    #[test]
    fn list_auto_creates_default() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let jars = s.list("ws1").unwrap();
        assert_eq!(jars.len(), 1);
        assert_eq!(jars[0].id, DEFAULT_JAR_ID);
        assert_eq!(jars[0].name, "Default");
    }

    #[test]
    fn ensure_default_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let a = s.ensure_default("ws1").unwrap();
        let b = s.ensure_default("ws1").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.created_at, b.created_at);
    }

    #[test]
    fn create_and_list_returns_default_first() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        // Force default first.
        s.ensure_default("ws1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let other = s.create("ws1".into(), "Other".into()).unwrap();
        let jars = s.list("ws1").unwrap();
        assert_eq!(jars[0].id, DEFAULT_JAR_ID);
        assert_eq!(jars[1].id, other.id);
    }

    #[test]
    fn save_then_get_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut jar = s.ensure_default("ws1").unwrap();
        jar.name = "Renamed".into();
        s.save(&jar).unwrap();
        let loaded = s.get("ws1", DEFAULT_JAR_ID).unwrap();
        assert_eq!(loaded.name, "Renamed");
    }

    #[test]
    fn delete_refuses_default_jar() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        s.ensure_default("ws1").unwrap();
        let err = s.delete("ws1", DEFAULT_JAR_ID).unwrap_err();
        assert!(matches!(err, VoleeoError::InvalidConfig(_)));
    }

    #[test]
    fn delete_removes_non_default_when_others_remain() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        s.ensure_default("ws1").unwrap();
        let other = s.create("ws1".into(), "Other".into()).unwrap();
        s.delete("ws1", &other.id).unwrap();
        let jars = s.list("ws1").unwrap();
        assert_eq!(jars.len(), 1);
    }

    #[test]
    fn delete_removes_last_non_default_jar() {
        // The Default jar always sticks around (auto-recreated by `list` /
        // `ensure_default`), so deleting the only non-default jar is allowed.
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        s.ensure_default("ws1").unwrap();
        let only_other = s.create("ws1".into(), "Other".into()).unwrap();
        s.delete("ws1", &only_other.id).unwrap();
        let jars = s.list("ws1").unwrap();
        assert_eq!(jars.len(), 1);
        assert_eq!(jars[0].id, DEFAULT_JAR_ID);
    }
}
