use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use voleeo_core::VoleeoError;

/// Machine-local per-workspace UI selections (e.g. the active cookie jar). Never
/// git-synced, but shared by the app and MCP server via one YAML file at
/// `{app_data_dir}/selections-local.yaml`. Always read fresh (no cache) so both
/// `SelectionStore` instances agree; writes are last-writer-wins (fine for
/// low-frequency, single-user actions).
#[derive(Clone)]
pub struct SelectionStore {
    path: PathBuf,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionsFile {
    /// workspace_id → active cookie jar id.
    #[serde(default)]
    active_jars: HashMap<String, String>,
}

impl SelectionStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        Ok(Self {
            path: app_data_dir.as_ref().join("selections-local.yaml"),
        })
    }

    fn read(&self) -> SelectionsFile {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_yaml::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write(&self, file: &SelectionsFile) -> Result<(), VoleeoError> {
        let content =
            serde_yaml::to_string(file).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(&self.path, content)
    }

    /// The active cookie jar for a workspace, or `None` when unset.
    pub fn active_jar(&self, workspace_id: &str) -> Option<String> {
        self.read().active_jars.get(workspace_id).cloned()
    }

    /// Set the active cookie jar for a workspace (`None` clears it).
    pub fn set_active_jar(
        &self,
        workspace_id: &str,
        jar_id: Option<&str>,
    ) -> Result<(), VoleeoError> {
        let mut file = self.read();
        match jar_id {
            Some(id) => {
                file.active_jars
                    .insert(workspace_id.to_string(), id.to_string());
            }
            None => {
                file.active_jars.remove(workspace_id);
            }
        }
        self.write(&file)
    }

    /// Drop a removed workspace's selections.
    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), VoleeoError> {
        let mut file = self.read();
        if file.active_jars.remove(workspace_id).is_some() {
            self.write(&file)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_clear_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = SelectionStore::new(dir.path()).unwrap();
        assert_eq!(store.active_jar("ws1"), None);

        store.set_active_jar("ws1", Some("jar_a")).unwrap();
        assert_eq!(store.active_jar("ws1"), Some("jar_a".to_string()));

        // A second instance over the same dir sees the same value (file-backed).
        let other = SelectionStore::new(dir.path()).unwrap();
        assert_eq!(other.active_jar("ws1"), Some("jar_a".to_string()));

        store.set_active_jar("ws1", None).unwrap();
        assert_eq!(store.active_jar("ws1"), None);
    }

    #[test]
    fn delete_workspace_drops_only_that_entry() {
        let dir = tempfile::tempdir().unwrap();
        let store = SelectionStore::new(dir.path()).unwrap();
        store.set_active_jar("ws1", Some("jar_a")).unwrap();
        store.set_active_jar("ws2", Some("jar_b")).unwrap();

        store.delete_workspace("ws1").unwrap();
        assert_eq!(store.active_jar("ws1"), None);
        assert_eq!(store.active_jar("ws2"), Some("jar_b".to_string()));
    }
}
