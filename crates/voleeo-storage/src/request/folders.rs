//! Folder CRUD: the `folder_*.yaml` half of `RequestStore`.

use super::{save_folder_if_changed, RequestStore};
use chrono::Utc;
use std::path::PathBuf;
use voleeo_core::{
    new_id, ApiFolder, AuthConfig, EnvironmentVariable, RequestParameter, VoleeoError,
};

impl RequestStore {
    fn folder_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("folder_{id}.yaml")))
    }

    pub fn list_folders(&self, workspace_id: &str) -> Result<Vec<ApiFolder>, VoleeoError> {
        let dir = self.workspace_dir(workspace_id)?;
        let mut items = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("folder_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let folder: ApiFolder =
                serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            items.push(folder);
        }
        items.sort_by(|a, b| {
            a.order
                .partial_cmp(&b.order)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    pub fn create_folder(
        &self,
        workspace_id: String,
        folder_id: Option<String>,
        name: String,
    ) -> Result<ApiFolder, VoleeoError> {
        self.workspace_dir(&workspace_id)?;
        let id = new_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let order = Utc::now().timestamp_millis() as f64;
        let folder = ApiFolder {
            id: id.clone(),
            folder_type: "api".to_string(),
            model: "folder".to_string(),
            workspace_id: workspace_id.clone(),
            folder_id,
            name,
            headers: vec![],
            auth: AuthConfig::None,
            variables: vec![],
            color: None,
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&folder).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.folder_path(&workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(folder)
    }

    pub fn get_folder(&self, workspace_id: &str, id: &str) -> Result<ApiFolder, VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        if !path.exists() {
            return Err(VoleeoError::NotFound(format!("folder {id}")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(folder)
    }

    /// Clone `src` into a fresh folder file (caller picks parent, name, order).
    fn copy_folder(
        &self,
        src: &ApiFolder,
        folder_id: Option<String>,
        name: String,
        order: f64,
    ) -> Result<ApiFolder, VoleeoError> {
        let id = new_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let folder = ApiFolder {
            id: id.clone(),
            folder_type: src.folder_type.clone(),
            model: src.model.clone(),
            workspace_id: src.workspace_id.clone(),
            folder_id,
            name,
            headers: src.headers.clone(),
            auth: src.auth.clone(),
            variables: src.variables.clone(),
            color: src.color.clone(),
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&folder).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.folder_path(&folder.workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(folder)
    }

    /// Recursively copy everything under `src_folder` into `dst_folder`.
    /// Children keep their names — only the top-level duplicate is renamed.
    fn copy_folder_children(
        &self,
        workspace_id: &str,
        src_folder: &str,
        dst_folder: &str,
    ) -> Result<(), VoleeoError> {
        for r in self.list_requests(workspace_id)? {
            if r.folder_id.as_deref() == Some(src_folder) {
                self.copy_request(&r, Some(dst_folder.to_string()), r.name.clone(), r.order)?;
            }
        }
        for f in self.list_folders(workspace_id)? {
            if f.folder_id.as_deref() == Some(src_folder) {
                let copy =
                    self.copy_folder(&f, Some(dst_folder.to_string()), f.name.clone(), f.order)?;
                self.copy_folder_children(workspace_id, &f.id, &copy.id)?;
            }
        }
        Ok(())
    }

    /// Duplicate a folder and everything inside it as a sibling directly
    /// below the original, named "Copy of {name}".
    pub fn duplicate_folder(&self, workspace_id: &str, id: &str) -> Result<ApiFolder, VoleeoError> {
        let src = self.get_folder(workspace_id, id)?;
        let order = self.order_after(workspace_id, src.folder_id.as_deref(), src.order)?;
        let copy = self.copy_folder(
            &src,
            src.folder_id.clone(),
            format!("Copy of {}", src.name),
            order,
        )?;
        self.copy_folder_children(workspace_id, id, &copy.id)?;
        Ok(copy)
    }

    pub fn rename_folder(
        &self,
        workspace_id: &str,
        id: &str,
        name: String,
    ) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = folder.clone();
        next.name = name;
        save_folder_if_changed(&path, &folder, next)
    }

    pub fn update_folder(
        &self,
        workspace_id: &str,
        id: &str,
        headers: Vec<RequestParameter>,
        auth: AuthConfig,
    ) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = folder.clone();
        next.headers = headers;
        next.auth = auth;
        save_folder_if_changed(&path, &folder, next)
    }

    pub fn update_folder_variables(
        &self,
        workspace_id: &str,
        id: &str,
        variables: Vec<EnvironmentVariable>,
    ) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = folder.clone();
        next.variables = variables;
        save_folder_if_changed(&path, &folder, next)
    }

    pub fn update_folder_color(
        &self,
        workspace_id: &str,
        id: &str,
        color: Option<String>,
    ) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = folder.clone();
        next.color = color;
        save_folder_if_changed(&path, &folder, next)
    }

    pub fn delete_folder(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn delete_folder_cascade(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let requests = self.list_requests(workspace_id)?;
        for req in requests
            .iter()
            .filter(|r| r.folder_id.as_deref() == Some(id))
        {
            self.delete_request(workspace_id, &req.id)?;
        }
        let folders = self.list_folders(workspace_id)?;
        for folder in folders
            .iter()
            .filter(|f| f.folder_id.as_deref() == Some(id))
        {
            self.delete_folder_cascade(workspace_id, &folder.id)?;
        }
        self.delete_folder(workspace_id, id)
    }

    pub fn update_folder_position(
        &self,
        workspace_id: &str,
        id: &str,
        folder_id: Option<String>,
        order: f64,
    ) -> Result<(), VoleeoError> {
        let path = self.folder_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let folder: ApiFolder =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = folder.clone();
        next.folder_id = folder_id;
        next.order = order;
        save_folder_if_changed(&path, &folder, next)
    }
}
