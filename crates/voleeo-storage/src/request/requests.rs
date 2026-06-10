//! Request CRUD: the `req_*.yaml` half of `RequestStore`.

use super::{save_request_if_changed, RequestStore};
use chrono::Utc;
use std::path::PathBuf;
use voleeo_core::{new_id, AuthConfig, HttpRequest, RequestBody, RequestParameter, VoleeoError};

impl RequestStore {
    fn req_path(&self, workspace_id: &str, id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(id)?;
        Ok(self
            .workspaces_dir
            .join(workspace_id)
            .join(format!("req_{id}.yaml")))
    }

    pub fn get_request(&self, workspace_id: &str, id: &str) -> Result<HttpRequest, VoleeoError> {
        let path = self.req_path(workspace_id, id)?;
        if !path.exists() {
            return Err(VoleeoError::NotFound(format!("request {id}")));
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let req: HttpRequest =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        if req.id != id {
            return Err(VoleeoError::Storage(format!(
                "request file id mismatch for {id}"
            )));
        }
        Ok(req)
    }

    pub fn list_requests(&self, workspace_id: &str) -> Result<Vec<HttpRequest>, VoleeoError> {
        let dir = self.workspace_dir(workspace_id)?;
        let mut items = Vec::new();
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if !filename.starts_with("req_") || !filename.ends_with(".yaml") {
                continue;
            }
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| VoleeoError::Storage(e.to_string()))?;
            let req: HttpRequest =
                serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            items.push(req);
        }
        // Order ascending; created_at breaks ties.
        items.sort_by(|a, b| {
            a.order
                .partial_cmp(&b.order)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(items)
    }

    pub fn create_request(
        &self,
        workspace_id: String,
        folder_id: Option<String>,
        name: String,
        method: String,
        url: String,
    ) -> Result<HttpRequest, VoleeoError> {
        self.workspace_dir(&workspace_id)?;
        let id = new_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let order = Utc::now().timestamp_millis() as f64;
        let req = HttpRequest {
            id: id.clone(),
            request_type: "api".to_string(),
            model: "http_request".to_string(),
            workspace_id: workspace_id.clone(),
            folder_id,
            method,
            name,
            url,
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&req).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.req_path(&workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(req)
    }

    /// Clone `src` into a fresh request file (caller picks folder, name, order).
    /// `pub(super)` so the folder-copy recursion can reach it from its sibling.
    pub(super) fn copy_request(
        &self,
        src: &HttpRequest,
        folder_id: Option<String>,
        name: String,
        order: f64,
    ) -> Result<HttpRequest, VoleeoError> {
        let id = new_id();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let req = HttpRequest {
            id: id.clone(),
            request_type: src.request_type.clone(),
            model: src.model.clone(),
            workspace_id: src.workspace_id.clone(),
            folder_id,
            method: src.method.clone(),
            name,
            url: src.url.clone(),
            parameters: src.parameters.clone(),
            headers: src.headers.clone(),
            body: src.body.clone(),
            auth: src.auth.clone(),
            order,
            created_at: now.clone(),
            updated_at: now,
        };
        let content =
            serde_yaml::to_string(&req).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(self.req_path(&req.workspace_id, &id)?, content)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(req)
    }

    /// Duplicate a request as a sibling directly below the original,
    /// named "Copy of {name}".
    pub fn duplicate_request(
        &self,
        workspace_id: &str,
        id: &str,
    ) -> Result<HttpRequest, VoleeoError> {
        let src = self.get_request(workspace_id, id)?;
        let order = self.order_after(workspace_id, src.folder_id.as_deref(), src.order)?;
        self.copy_request(
            &src,
            src.folder_id.clone(),
            format!("Copy of {}", src.name),
            order,
        )
    }

    pub fn rename_request(
        &self,
        workspace_id: &str,
        id: &str,
        name: String,
    ) -> Result<(), VoleeoError> {
        let path = self.req_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let req: HttpRequest =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = req.clone();
        next.name = name;
        save_request_if_changed(&path, &req, next)
    }

    pub fn update_request(
        &self,
        workspace_id: &str,
        id: &str,
        method: String,
        url: String,
        parameters: Vec<RequestParameter>,
        headers: Vec<RequestParameter>,
        body: Option<RequestBody>,
        auth: AuthConfig,
    ) -> Result<(), VoleeoError> {
        let path = self.req_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let req: HttpRequest =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = req.clone();
        next.method = method;
        next.url = url;
        next.parameters = parameters;
        next.headers = headers;
        next.body = body;
        next.auth = auth;
        save_request_if_changed(&path, &req, next)
    }

    pub fn delete_request(&self, workspace_id: &str, id: &str) -> Result<(), VoleeoError> {
        let path = self.req_path(workspace_id, id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn update_request_position(
        &self,
        workspace_id: &str,
        id: &str,
        folder_id: Option<String>,
        order: f64,
    ) -> Result<(), VoleeoError> {
        let path = self.req_path(workspace_id, id)?;
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let req: HttpRequest =
            serde_yaml::from_str(&content).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let mut next = req.clone();
        next.folder_id = folder_id;
        next.order = order;
        save_request_if_changed(&path, &req, next)
    }
}
