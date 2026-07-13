//! `RequestStore` — `req_*.yaml` and `folder_*.yaml` files for one workspace.
//! The `impl` is split across `requests` and `folders`; this module owns the
//! struct, construction, and helpers shared by both (change-aware saves, sibling
//! ordering, cross-type moves).

use chrono::Utc;
use std::path::{Path, PathBuf};
use voleeo_core::{ApiFolder, HttpRequest, ItemKind, MoveItemUpdate, VoleeoError};

mod folders;
mod requests;

fn now_ts() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string()
}

/// Persist `req` only when a meaningful field changed vs `original`, bumping
/// `updated_at` in that case. An edit that leaves every field as-is (or reverts
/// to the saved value) is a no-op — the file and its timestamp stay untouched, so
/// it never surfaces as a phantom `updatedAt`-only git change.
fn save_request_if_changed(
    path: &Path,
    original: &HttpRequest,
    mut req: HttpRequest,
) -> Result<(), VoleeoError> {
    req.updated_at = original.updated_at.clone();
    if req == *original {
        return Ok(());
    }
    req.updated_at = now_ts();
    let content = serde_yaml::to_string(&req).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    crate::write_atomic(path, content)
}

/// Folder counterpart of [`save_request_if_changed`].
fn save_folder_if_changed(
    path: &Path,
    original: &ApiFolder,
    mut folder: ApiFolder,
) -> Result<(), VoleeoError> {
    folder.updated_at = original.updated_at.clone();
    if folder == *original {
        return Ok(());
    }
    folder.updated_at = now_ts();
    let content =
        serde_yaml::to_string(&folder).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    crate::write_atomic(path, content)
}

/// Manages `req_*.yaml` and `folder_*.yaml` files for a single workspace.
///
/// Files live at: `{app_data_dir}/workspaces/{workspace_id}/`
#[derive(Clone)]
pub struct RequestStore {
    /// `{app_data_dir}/workspaces/`
    workspaces_dir: PathBuf,
}

impl RequestStore {
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

    /// Smallest order strictly greater than `after` among siblings sharing
    /// `parent_id`; the midpoint places a new item directly below `after`.
    /// Falls back to `after + 1.0` when `after` is already the last sibling.
    fn order_after(
        &self,
        workspace_id: &str,
        parent_id: Option<&str>,
        after: f64,
    ) -> Result<f64, VoleeoError> {
        let mut next: Option<f64> = None;
        for r in self.list_requests(workspace_id)? {
            if r.folder_id.as_deref() == parent_id && r.order > after {
                next = Some(next.map_or(r.order, |n| n.min(r.order)));
            }
        }
        for f in self.list_folders(workspace_id)? {
            if f.folder_id.as_deref() == parent_id && f.order > after {
                next = Some(next.map_or(f.order, |n| n.min(f.order)));
            }
        }
        Ok(next.map_or(after + 1.0, |n| (after + n) / 2.0))
    }

    /// Write pre-built folders + requests verbatim — ids, `order`, and
    /// `folder_id` are already set by the caller (`voleeo_import::build_plan`).
    /// Skips the change-detection + sibling-ordering the CRUD paths do; used by
    /// collection import to land a whole tree in one pass.
    pub fn write_bulk(
        &self,
        folders: &[ApiFolder],
        requests: &[HttpRequest],
    ) -> Result<(), VoleeoError> {
        for f in folders {
            let dir = self.workspace_dir(&f.workspace_id)?;
            crate::validate_id(&f.id)?;
            let content =
                serde_yaml::to_string(f).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            crate::write_atomic(dir.join(format!("folder_{}.yaml", f.id)), content)?;
        }
        for r in requests {
            let dir = self.workspace_dir(&r.workspace_id)?;
            crate::validate_id(&r.id)?;
            let content =
                serde_yaml::to_string(r).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            crate::write_atomic(dir.join(format!("req_{}.yaml", r.id)), content)?;
        }
        Ok(())
    }

    pub fn move_items(
        &self,
        workspace_id: &str,
        updates: Vec<MoveItemUpdate>,
    ) -> Result<(), VoleeoError> {
        for u in updates {
            match u.kind {
                ItemKind::Request => {
                    self.update_request_position(workspace_id, &u.id, u.folder_id, u.order)?
                }
                ItemKind::Folder => {
                    self.update_folder_position(workspace_id, &u.id, u.folder_id, u.order)?
                }
                // WS connections and gRPC requests live in sibling stores; the
                // `move_items` command dispatches those to their own
                // `update_position`.
                ItemKind::WebSocket | ItemKind::Grpc => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{now_iso, AuthConfig};

    #[test]
    fn write_bulk_persists_tree_with_order_and_parent() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let now = now_iso();
        let folder = ApiFolder {
            id: "fold1234".into(),
            folder_type: "api".into(),
            model: "folder".into(),
            workspace_id: "ws1".into(),
            folder_id: None,
            name: "Imported".into(),
            headers: vec![],
            auth: AuthConfig::None,
            variables: vec![],
            color: None,
            order: 5000.0,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let req = HttpRequest {
            id: "req12345".into(),
            request_type: "api".into(),
            model: "http_request".into(),
            workspace_id: "ws1".into(),
            folder_id: Some("fold1234".into()),
            method: "GET".into(),
            name: "Listed".into(),
            url: "https://example.com/:id".into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order: 5001.0,
            created_at: now.clone(),
            updated_at: now,
        };
        s.write_bulk(std::slice::from_ref(&folder), std::slice::from_ref(&req))
            .unwrap();

        let folders = s.list_folders("ws1").unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Imported");

        let reqs = s.list_requests("ws1").unwrap();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].folder_id.as_deref(), Some("fold1234"));
        assert_eq!(reqs[0].order, 5001.0);
        assert_eq!(reqs[0].url, "https://example.com/:id");
    }

    fn store(dir: &tempfile::TempDir) -> RequestStore {
        RequestStore::new(dir.path()).unwrap()
    }

    fn mk_req(s: &RequestStore, ws: &str) -> HttpRequest {
        s.create_request(
            ws.into(),
            None,
            "Test".into(),
            "GET".into(),
            "https://example.com".into(),
        )
        .unwrap()
    }

    // ── Requests ──────────────────────────────────────────────────────────────

    #[test]
    fn create_and_get_request() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        let loaded = s.get_request("ws1", &req.id).unwrap();
        assert_eq!(loaded.id, req.id);
        assert_eq!(loaded.method, "GET");
        assert_eq!(loaded.url, "https://example.com");
    }

    #[test]
    fn get_request_returns_not_found_for_unknown_id() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert!(matches!(
            s.get_request("ws1", "nope").unwrap_err(),
            VoleeoError::NotFound(_)
        ));
    }

    #[test]
    fn list_requests_sorted_by_order() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let a = mk_req(&s, "ws1");
        let b = mk_req(&s, "ws1");
        s.update_request_position("ws1", &a.id, None, 2.0).unwrap();
        s.update_request_position("ws1", &b.id, None, 1.0).unwrap();
        let list = s.list_requests("ws1").unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }

    #[test]
    fn rename_request_updates_name() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        s.rename_request("ws1", &req.id, "Renamed".into()).unwrap();
        assert_eq!(s.get_request("ws1", &req.id).unwrap().name, "Renamed");
    }

    #[test]
    fn update_request_fields() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        s.update_request(
            "ws1",
            &req.id,
            "POST".into(),
            "https://new.com".into(),
            vec![],
            vec![],
            None,
            AuthConfig::None,
        )
        .unwrap();
        let loaded = s.get_request("ws1", &req.id).unwrap();
        assert_eq!(loaded.method, "POST");
        assert_eq!(loaded.url, "https://new.com");
    }

    #[test]
    fn update_request_noop_keeps_updated_at() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        let before = s.get_request("ws1", &req.id).unwrap().updated_at;
        // Re-save with the exact same field values — must not touch the file.
        s.update_request(
            "ws1",
            &req.id,
            req.method.clone(),
            req.url.clone(),
            req.parameters.clone(),
            req.headers.clone(),
            req.body.clone(),
            req.auth.clone(),
        )
        .unwrap();
        assert_eq!(s.get_request("ws1", &req.id).unwrap().updated_at, before);

        // A real change bumps updated_at.
        s.update_request(
            "ws1",
            &req.id,
            "POST".into(),
            req.url.clone(),
            vec![],
            vec![],
            None,
            AuthConfig::None,
        )
        .unwrap();
        assert_ne!(s.get_request("ws1", &req.id).unwrap().updated_at, before);
    }

    #[test]
    fn delete_request_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        s.delete_request("ws1", &req.id).unwrap();
        assert!(matches!(
            s.get_request("ws1", &req.id).unwrap_err(),
            VoleeoError::NotFound(_)
        ));
    }

    #[test]
    fn duplicate_request_copies_below_original() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let req = mk_req(&s, "ws1");
        let copy = s.duplicate_request("ws1", &req.id).unwrap();
        assert_eq!(copy.name, format!("Copy of {}", req.name));
        assert_ne!(copy.id, req.id);
        assert!(copy.order > req.order);
    }

    #[test]
    fn duplicate_inserts_between_siblings() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let a = mk_req(&s, "ws1");
        let c = mk_req(&s, "ws1");
        s.update_request_position("ws1", &a.id, None, 1.0).unwrap();
        s.update_request_position("ws1", &c.id, None, 3.0).unwrap();
        // Copy should land between a (1.0) and c (3.0), not after c.
        let copy = s.duplicate_request("ws1", &a.id).unwrap();
        let loaded_a = s.get_request("ws1", &a.id).unwrap();
        assert!(copy.order > loaded_a.order && copy.order < 3.0);
    }

    // ── Folders ───────────────────────────────────────────────────────────────

    #[test]
    fn create_and_get_folder() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let f = s.create_folder("ws1".into(), None, "Auth".into()).unwrap();
        let loaded = s.get_folder("ws1", &f.id).unwrap();
        assert_eq!(loaded.name, "Auth");
    }

    #[test]
    fn rename_folder() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let f = s.create_folder("ws1".into(), None, "Old".into()).unwrap();
        s.rename_folder("ws1", &f.id, "New".into()).unwrap();
        assert_eq!(s.get_folder("ws1", &f.id).unwrap().name, "New");
    }

    #[test]
    fn descendant_request_ids_covers_nested_subfolders() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let parent = s
            .create_folder("ws1".into(), None, "Parent".into())
            .unwrap();
        let child_folder = s
            .create_folder("ws1".into(), Some(parent.id.clone()), "Child".into())
            .unwrap();
        let r1 = s
            .create_request(
                "ws1".into(),
                Some(parent.id.clone()),
                "R1".into(),
                "GET".into(),
                "/".into(),
            )
            .unwrap();
        let r2 = s
            .create_request(
                "ws1".into(),
                Some(child_folder.id.clone()),
                "R2".into(),
                "GET".into(),
                "/".into(),
            )
            .unwrap();

        let mut ids = s.descendant_request_ids("ws1", &parent.id).unwrap();
        ids.sort();
        let mut expected = vec![r1.id, r2.id];
        expected.sort();
        assert_eq!(ids, expected);
    }

    #[test]
    fn delete_folder_cascade_removes_children() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let parent = s
            .create_folder("ws1".into(), None, "Parent".into())
            .unwrap();
        let child_folder = s
            .create_folder("ws1".into(), Some(parent.id.clone()), "Child".into())
            .unwrap();
        let r1 = s
            .create_request(
                "ws1".into(),
                Some(parent.id.clone()),
                "R1".into(),
                "GET".into(),
                "/".into(),
            )
            .unwrap();
        let r2 = s
            .create_request(
                "ws1".into(),
                Some(child_folder.id.clone()),
                "R2".into(),
                "GET".into(),
                "/".into(),
            )
            .unwrap();
        s.delete_folder_cascade("ws1", &parent.id).unwrap();
        assert!(s.list_requests("ws1").unwrap().is_empty());
        assert!(s.list_folders("ws1").unwrap().is_empty());
        let _ = (&r1.id, &r2.id, &child_folder.id); // silence unused warnings
    }

    #[test]
    fn duplicate_folder_copies_tree() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let parent = s
            .create_folder("ws1".into(), None, "Parent".into())
            .unwrap();
        let child = s
            .create_folder("ws1".into(), Some(parent.id.clone()), "Child".into())
            .unwrap();
        s.create_request(
            "ws1".into(),
            Some(child.id.clone()),
            "Req".into(),
            "GET".into(),
            "/".into(),
        )
        .unwrap();
        let copy = s.duplicate_folder("ws1", &parent.id).unwrap();
        assert_eq!(copy.name, format!("Copy of {}", parent.name));
        let folders = s.list_folders("ws1").unwrap();
        assert_eq!(folders.len(), 4); // parent, child, copy-parent, copy-child
        let requests = s.list_requests("ws1").unwrap();
        assert_eq!(requests.len(), 2); // original + copied request
    }

    #[test]
    fn move_items_updates_position_and_folder() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let folder = s
            .create_folder("ws1".into(), None, "Folder".into())
            .unwrap();
        let req = mk_req(&s, "ws1");
        s.move_items(
            "ws1",
            vec![MoveItemUpdate {
                id: req.id.clone(),
                kind: ItemKind::Request,
                folder_id: Some(folder.id.clone()),
                order: 42.0,
            }],
        )
        .unwrap();
        let loaded = s.get_request("ws1", &req.id).unwrap();
        assert_eq!(loaded.folder_id, Some(folder.id));
        assert_eq!(loaded.order, 42.0);
    }
}
