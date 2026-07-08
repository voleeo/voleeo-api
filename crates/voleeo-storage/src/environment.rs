use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, Environment, EnvironmentKind, EnvironmentVariable, VoleeoError};

/// Manages `env_*.yaml` files for a single workspace.
///
/// Files live in two locations:
/// - **Shared** (`shared = true`): `{app_data_dir}/workspaces/{workspace_id}/env_{id}.yaml`
///   — co-located with the workspace, so they get synced if `workspaces/{id}` is symlinked
///   to a sync folder (Git/Dropbox/etc).
/// - **Local** (`shared = false`): `{app_data_dir}/envs-local/{workspace_id}/env_{id}.yaml`
///   — completely outside the `workspaces/` tree, so they can never end up in a sync folder.
///
/// `list` reads from both directories and merges by id (shared wins on conflict).
/// `save` writes to the right directory based on the env's `shared` flag, and removes
/// the file from the *other* directory if a previous version existed there.
#[derive(Clone)]
pub struct EnvironmentStore {
    workspaces_dir: PathBuf,
    envs_local_dir: PathBuf,
}

/// Fixed id used for each workspace's auto-created Global Environment.
pub const GLOBAL_ENV_ID: &str = "global";

impl EnvironmentStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let app_data_dir = app_data_dir.as_ref();
        let workspaces_dir = app_data_dir.join("workspaces");
        let envs_local_dir = app_data_dir.join("envs-local");
        std::fs::create_dir_all(&workspaces_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::create_dir_all(&envs_local_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            workspaces_dir,
            envs_local_dir,
        })
    }

    fn shared_dir(&self, workspace_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.workspaces_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(dir)
    }

    fn local_dir(&self, workspace_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.envs_local_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(dir)
    }

    fn shared_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("env_{id}.yaml")))
    }

    fn local_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .envs_local_dir
            .join(workspace_id)
            .join(format!("env_{id}.yaml")))
    }

    /// Read all envs from both shared and local dirs. Shared wins on id conflict.
    pub fn list(&self, workspace_id: &str) -> Result<Vec<Environment>, VoleeoError> {
        let mut by_id: HashMap<String, Environment> = HashMap::new();
        for dir in [
            self.local_dir(workspace_id)?,
            self.shared_dir(workspace_id)?,
        ] {
            for entry in std::fs::read_dir(&dir)
                .map_err(|e| VoleeoError::Storage(e.to_string()))?
                .flatten()
            {
                let name = entry.file_name();
                let filename = name.to_string_lossy();
                if !filename.starts_with("env_") || !filename.ends_with(".yaml") {
                    continue;
                }
                let content = std::fs::read_to_string(entry.path())
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                let env: Environment = serde_yaml::from_str(&content)
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                by_id.insert(env.id.clone(), env);
            }
        }
        let mut items: Vec<Environment> = by_id.into_values().collect();
        // Global first, then personal envs by created_at.
        items.sort_by(|a, b| {
            let kind_order = |k: &EnvironmentKind| match k {
                EnvironmentKind::Global => 0,
                EnvironmentKind::Personal => 1,
            };
            kind_order(&a.kind)
                .cmp(&kind_order(&b.kind))
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    pub fn get(&self, workspace_id: &str, id: &str) -> Result<Option<Environment>, VoleeoError> {
        for path in [
            self.shared_path(workspace_id, id)?,
            self.local_path(workspace_id, id)?,
        ] {
            if path.exists() {
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                let env: Environment = serde_yaml::from_str(&content)
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                return Ok(Some(env));
            }
        }
        Ok(None)
    }

    /// Persist `env`. Writes to shared or local dir based on `env.shared`. If the file
    /// existed in the other dir (shared flag flipped), removes the stale copy.
    pub fn save(&self, env: &Environment) -> Result<(), VoleeoError> {
        let target = if env.shared {
            self.shared_path(&env.workspace_id, &env.id)?
        } else {
            self.local_path(&env.workspace_id, &env.id)?
        };
        let other = if env.shared {
            self.local_path(&env.workspace_id, &env.id)?
        } else {
            self.shared_path(&env.workspace_id, &env.id)?
        };

        // Make sure the target's parent dir exists.
        if env.shared {
            self.shared_dir(&env.workspace_id)?;
        } else {
            self.local_dir(&env.workspace_id)?;
        }

        let content =
            serde_yaml::to_string(env).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(&target, content)?;

        if other.exists() {
            std::fs::remove_file(&other).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn delete(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        for path in [
            self.shared_path(workspace_id, id)?,
            self.local_path(workspace_id, id)?,
        ] {
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            }
        }
        Ok(())
    }

    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), VoleeoError> {
        crate::validate_id(workspace_id)?;
        let local = self.envs_local_dir.join(workspace_id);
        if local.exists() {
            std::fs::remove_dir_all(&local).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    /// Ensure a Global Environment exists for the workspace. Returns the existing one or creates a new one.
    pub fn ensure_global(&self, workspace_id: &str) -> Result<Environment, VoleeoError> {
        if let Some(env) = self.get(workspace_id, GLOBAL_ENV_ID)? {
            return Ok(env);
        }
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let env = Environment {
            id: GLOBAL_ENV_ID.to_string(),
            workspace_id: workspace_id.to_string(),
            kind: EnvironmentKind::Global,
            name: "Global Environment".to_string(),
            color: String::new(),
            shared: false,
            variables: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.save(&env)?;
        Ok(env)
    }

    pub fn create_personal(
        &self,
        workspace_id: String,
        name: String,
        color: String,
        shared: bool,
    ) -> Result<Environment, VoleeoError> {
        let id = new_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let env = Environment {
            id,
            workspace_id,
            kind: EnvironmentKind::Personal,
            name,
            color,
            shared,
            variables: Vec::<EnvironmentVariable>::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.save(&env)?;
        Ok(env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> EnvironmentStore {
        EnvironmentStore::new(dir.path()).unwrap()
    }

    #[test]
    fn ensure_global_creates_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let g1 = s.ensure_global("ws1").unwrap();
        assert_eq!(g1.id, GLOBAL_ENV_ID);
        assert_eq!(g1.kind, EnvironmentKind::Global);
        // Second call must return the existing one without overwriting.
        let g2 = s.ensure_global("ws1").unwrap();
        assert_eq!(g1.created_at, g2.created_at);
    }

    #[test]
    fn create_personal_local_by_default() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let env = s
            .create_personal("ws1".into(), "Dev".into(), "#f00".into(), false)
            .unwrap();
        assert_eq!(env.kind, EnvironmentKind::Personal);
        // File must be in the local dir, not the workspace dir.
        assert!(dir
            .path()
            .join("envs-local")
            .join("ws1")
            .join(format!("env_{}.yaml", env.id))
            .exists());
        assert!(!dir
            .path()
            .join("workspaces")
            .join("ws1")
            .join(format!("env_{}.yaml", env.id))
            .exists());
    }

    #[test]
    fn list_global_sorts_before_personal() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        s.ensure_global("ws1").unwrap();
        s.create_personal("ws1".into(), "Personal".into(), String::new(), false)
            .unwrap();
        let list = s.list("ws1").unwrap();
        assert_eq!(list[0].kind, EnvironmentKind::Global);
        assert_eq!(list[1].kind, EnvironmentKind::Personal);
    }

    #[test]
    fn get_returns_none_for_missing_env() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert!(s.get("ws1", "nonexistent").unwrap().is_none());
    }

    #[test]
    fn save_shared_flag_flip_migrates_file() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        // Start as local (shared = false).
        let mut env = s
            .create_personal("ws1".into(), "Env".into(), String::new(), false)
            .unwrap();
        let local_path = dir
            .path()
            .join("envs-local")
            .join("ws1")
            .join(format!("env_{}.yaml", env.id));
        let shared_path = dir
            .path()
            .join("workspaces")
            .join("ws1")
            .join(format!("env_{}.yaml", env.id));
        assert!(local_path.exists());
        assert!(!shared_path.exists());
        // Flip to shared — file should move.
        env.shared = true;
        s.save(&env).unwrap();
        assert!(!local_path.exists(), "stale local copy should be removed");
        assert!(shared_path.exists(), "new shared copy should exist");
    }

    #[test]
    fn delete_removes_env_from_both_locations() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let env = s
            .create_personal("ws1".into(), "Env".into(), String::new(), false)
            .unwrap();
        s.delete("ws1", &env.id).unwrap();
        assert!(s.get("ws1", &env.id).unwrap().is_none());
    }

    #[test]
    fn list_shared_wins_over_local_on_id_conflict() {
        // Write the same env id to both dirs and check shared takes precedence.
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut env = s
            .create_personal("ws1".into(), "Local".into(), String::new(), false)
            .unwrap();
        // Also write a shared copy with a different name but same id.
        let shared_dir = dir.path().join("workspaces").join("ws1");
        std::fs::create_dir_all(&shared_dir).unwrap();
        let mut shared_env = env.clone();
        shared_env.name = "Shared".into();
        shared_env.shared = true;
        let content = serde_yaml::to_string(&shared_env).unwrap();
        std::fs::write(shared_dir.join(format!("env_{}.yaml", env.id)), content).unwrap();
        // list() should return "Shared" (the shared copy wins).
        let list = s.list("ws1").unwrap();
        let found = list.iter().find(|e| e.id == env.id).unwrap();
        assert_eq!(found.name, "Shared");
        // Silence unused-mut warning.
        let _ = &mut env;
    }
}
