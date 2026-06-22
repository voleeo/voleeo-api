use crate::body_window::{
    self, apply_jsonpath, count_lines, format_for_storage, BodyCache, BodyFilterResult,
    BodySearchResult, BodyWindow, SearchOpts, SharedBodyCache, WINDOW_THRESHOLD,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use voleeo_core::{new_id, HttpResponse, VoleeoError};

/// Persisted HTTP response entry (machine-local, never synced).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredHttpResponse {
    pub id: String,
    pub workspace_id: String,
    pub request_id: String,
    pub recorded_at: String,
    pub response: HttpResponse,
}

/// Lightweight summary returned by `response_list` — avoids loading full bodies.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredHttpResponseSummary {
    pub id: String,
    pub request_id: String,
    pub recorded_at: String,
    pub status: u16,
    pub status_text: String,
    pub body_size: u32,
    pub total_ms: f64,
}

/// Manages per-request response history stored at
/// `{app_data_dir}/responses-local/{workspace_id}/req_{request_id}.yaml`.
///
/// Each file is a YAML `Vec<StoredHttpResponse>` (newest first), trimmed to
/// `limit` entries on every append. Files are machine-local and never inside
/// `workspaces/`, mirroring the `envs-local/` convention.
#[derive(Clone)]
pub struct ResponseStore {
    responses_local_dir: PathBuf,
    /// Hot cache of parsed windowed bodies, shared across `clone()`s.
    cache: SharedBodyCache,
}

impl ResponseStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let responses_local_dir = app_data_dir.as_ref().join("responses-local");
        std::fs::create_dir_all(&responses_local_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            responses_local_dir,
            cache: Arc::new(Mutex::new(BodyCache::default())),
        })
    }

    fn body_file(&self, workspace_id: &str, response_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        // `response_id` may carry a `.filter`/`.body` suffix for side files, so
        // validate EVERY dot-separated segment — a bare-id check on the prefix
        // alone would let traversal chars after the first `.` (e.g.
        // `id.x/../../etc`) slip into the joined path.
        for segment in response_id.split('.') {
            crate::validate_id(segment)?;
        }
        Ok(self
            .responses_local_dir
            .join(workspace_id)
            .join("bodies")
            .join(format!("{response_id}.body")))
    }

    /// Slim large text bodies out of line: pretty-print JSON, write the body to
    /// its side file, and replace `body` with windowing metadata. Small/binary
    /// bodies stay inline so the existing CodeMirror/iframe paths keep working.
    fn prepare_for_store(
        &self,
        workspace_id: &str,
        id: &str,
        mut response: HttpResponse,
    ) -> Result<HttpResponse, VoleeoError> {
        response.response_id = id.to_string();
        if response.body_is_text && response.body.len() > WINDOW_THRESHOLD {
            let formatted = format_for_storage(&response.body);
            response.body_line_count = count_lines(&formatted);
            let path = self.body_file(workspace_id, id)?;
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            }
            std::fs::write(&path, formatted).map_err(|e| VoleeoError::Storage(e.to_string()))?;
            response.body = String::new();
            response.body_windowed = true;
        }
        Ok(response)
    }

    /// Drop the side files (body + any active filter) and cache entries of
    /// trimmed/cleared entries.
    fn remove_body_files(&self, workspace_id: &str, entries: &[StoredHttpResponse]) {
        for e in entries {
            if !e.response.body_windowed {
                continue;
            }
            let filter_key = format!("{}.filter", e.id);
            if let Ok(p) = self.body_file(workspace_id, &e.id) {
                let _ = std::fs::remove_file(p);
            }
            if let Ok(p) = self.body_file(workspace_id, &filter_key) {
                let _ = std::fs::remove_file(p);
            }
            if let Ok(mut c) = self.cache.lock() {
                c.invalidate(&e.id);
                c.invalidate(&filter_key);
            }
        }
    }

    /// Apply a JSONPath query to a windowed body, writing the filtered result to
    /// a side file the frontend then windows/searches. Empty query clears it.
    pub fn body_filter(
        &self,
        workspace_id: &str,
        response_id: &str,
        query: &str,
    ) -> Result<BodyFilterResult, VoleeoError> {
        let key = format!("{response_id}.filter");
        let clear = |s: &Self| {
            if let Ok(p) = s.body_file(workspace_id, &key) {
                let _ = std::fs::remove_file(p);
            }
            if let Ok(mut c) = s.cache.lock() {
                c.invalidate(&key);
            }
        };
        if query.trim().is_empty() {
            clear(self);
            return Ok(BodyFilterResult {
                filter_key: key,
                line_count: 0,
                match_count: 0,
                error: None,
            });
        }

        let text = std::fs::read_to_string(self.body_file(workspace_id, response_id)?)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        match apply_jsonpath(&text, query) {
            Ok((filtered, match_count)) => {
                let path = self.body_file(workspace_id, &key)?;
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir)
                        .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                }
                std::fs::write(&path, &filtered)
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?;
                if let Ok(mut c) = self.cache.lock() {
                    c.invalidate(&key);
                }
                Ok(BodyFilterResult {
                    filter_key: key,
                    line_count: count_lines(&filtered),
                    match_count,
                    error: None,
                })
            }
            Err(error) => {
                clear(self);
                Ok(BodyFilterResult {
                    filter_key: key,
                    line_count: 0,
                    match_count: 0,
                    error: Some(error),
                })
            }
        }
    }

    /// A line window of a stored windowed body.
    pub fn body_window(
        &self,
        workspace_id: &str,
        response_id: &str,
        start_line: u32,
        count: u32,
    ) -> Result<BodyWindow, VoleeoError> {
        let path = self.body_file(workspace_id, response_id)?;
        body_window::window(
            &self.cache,
            response_id,
            || std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string())),
            start_line,
            count,
        )
    }

    /// Search a stored windowed body for `query`.
    pub fn body_search(
        &self,
        workspace_id: &str,
        response_id: &str,
        query: &str,
        opts: &SearchOpts,
    ) -> Result<BodySearchResult, VoleeoError> {
        let path = self.body_file(workspace_id, response_id)?;
        body_window::search(
            &self.cache,
            response_id,
            || std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string())),
            query,
            opts,
        )
    }

    fn workspace_dir(&self, workspace_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(dir)
    }

    fn file_path(&self, workspace_id: &str, request_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(request_id)?;
        Ok(self
            .responses_local_dir
            .join(workspace_id)
            .join(format!("req_{request_id}.yaml")))
    }

    fn read_all(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<Vec<StoredHttpResponse>, VoleeoError> {
        let path = self.file_path(workspace_id, request_id)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let items: Vec<StoredHttpResponse> = serde_yaml::from_str(&content).unwrap_or_default();
        Ok(items)
    }

    fn write_all(
        &self,
        workspace_id: &str,
        request_id: &str,
        items: &[StoredHttpResponse],
    ) -> Result<(), VoleeoError> {
        self.workspace_dir(workspace_id)?;
        let path = self.file_path(workspace_id, request_id)?;
        let content =
            serde_yaml::to_string(items).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(&path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    /// Prepend `response` to the history ring buffer, trimming to `limit` entries.
    /// `limit = 0` disables storage and is a no-op.
    pub fn append(
        &self,
        workspace_id: &str,
        request_id: &str,
        response: HttpResponse,
        limit: usize,
    ) -> Result<StoredHttpResponse, VoleeoError> {
        let id = new_id();
        let recorded_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        // Not persisted → keep the body inline (no side file to window later).
        if limit == 0 {
            let mut response = response;
            response.response_id = id.clone();
            return Ok(StoredHttpResponse {
                id,
                workspace_id: workspace_id.to_string(),
                request_id: request_id.to_string(),
                recorded_at,
                response,
            });
        }

        let response = self.prepare_for_store(workspace_id, &id, response)?;
        let stored = StoredHttpResponse {
            id,
            workspace_id: workspace_id.to_string(),
            request_id: request_id.to_string(),
            recorded_at,
            response,
        };

        let mut items = self.read_all(workspace_id, request_id)?;
        items.insert(0, stored.clone());
        if items.len() > limit {
            let dropped = items.split_off(limit);
            self.remove_body_files(workspace_id, &dropped);
        }
        self.write_all(workspace_id, request_id, &items)?;
        Ok(stored)
    }

    pub fn list(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<Vec<StoredHttpResponseSummary>, VoleeoError> {
        let items = self.read_all(workspace_id, request_id)?;
        Ok(items
            .into_iter()
            .map(|r| StoredHttpResponseSummary {
                id: r.id,
                request_id: r.request_id,
                recorded_at: r.recorded_at,
                status: r.response.status,
                status_text: r.response.status_text,
                body_size: r.response.body_size,
                total_ms: r.response.timing.total_ms,
            })
            .collect())
    }

    pub fn get(
        &self,
        workspace_id: &str,
        request_id: &str,
        response_id: &str,
    ) -> Result<Option<StoredHttpResponse>, VoleeoError> {
        let items = self.read_all(workspace_id, request_id)?;
        Ok(items.into_iter().find(|r| r.id == response_id))
    }

    pub fn clear(&self, workspace_id: &str, request_id: &str) -> Result<(), VoleeoError> {
        let entries = self.read_all(workspace_id, request_id)?;
        self.remove_body_files(workspace_id, &entries);
        let path = self.file_path(workspace_id, request_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{HttpResponse, HttpTiming};

    fn dummy_response(request_id: &str) -> HttpResponse {
        HttpResponse {
            request_id: request_id.to_string(),
            status: 200,
            status_text: "OK".to_string(),
            headers: vec![],
            body: "hello".to_string(),
            body_size: 5,
            body_is_text: true,
            body_windowed: false,
            body_line_count: 0,
            response_id: String::new(),
            timing: HttpTiming {
                dns_ms: 0.0,
                connect_ms: 0.0,
                tls_ms: 0.0,
                first_byte_ms: 10.0,
                download_ms: 1.0,
                total_ms: 11.0,
            },
            events: vec![],
            redirect_warning: None,
            captured_cookies: vec![],
            attached_cookies: vec![],
        }
    }

    fn large_json(rows: usize) -> String {
        let items: Vec<String> = (0..rows).map(|i| format!("{{\"i\":{i}}}")).collect();
        format!("[{}]", items.join(","))
    }

    #[test]
    fn test_ring_buffer_trim() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResponseStore::new(dir.path()).unwrap();
        let ws = "ws1";
        let req = "req1";

        for _ in 0..12 {
            store.append(ws, req, dummy_response(req), 10).unwrap();
        }

        let list = store.list(ws, req).unwrap();
        assert_eq!(list.len(), 10);
    }

    #[test]
    fn test_limit_zero_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResponseStore::new(dir.path()).unwrap();
        store.append("ws", "req", dummy_response("req"), 0).unwrap();
        let list = store.list("ws", "req").unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_clear() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResponseStore::new(dir.path()).unwrap();
        store.append("ws", "req", dummy_response("req"), 5).unwrap();
        store.clear("ws", "req").unwrap();
        let list = store.list("ws", "req").unwrap();
        assert_eq!(list.len(), 0);
    }

    fn windowed_store() -> (tempfile::TempDir, ResponseStore, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = ResponseStore::new(dir.path()).unwrap();
        let mut resp = dummy_response("req");
        resp.body = large_json(40_000); // > 256 KiB → windowed + pretty-printed
        resp.body_size = resp.body.len() as u32;
        let stored = store.append("ws", "req", resp, 5).unwrap();
        assert!(stored.response.body_windowed);
        assert!(stored.response.body.is_empty());
        assert!(stored.response.body_line_count > 1);
        (dir, store, stored.id)
    }

    #[test]
    fn windowed_body_writes_side_file_and_reads_windows() {
        let (_d, store, id) = windowed_store();
        let w = store.body_window("ws", &id, 0, 5).unwrap();
        assert_eq!(w.lines.len(), 5);
        assert!(w.total_lines > 1);
        // Pretty-printed JSON: first line is the opening bracket.
        assert_eq!(w.lines[0].trim(), "[");

        // A window past the end clamps rather than panicking.
        let tail = store
            .body_window("ws", &id, w.total_lines + 100, 10)
            .unwrap();
        assert!(tail.lines.is_empty());
    }

    #[test]
    fn windowed_body_search_finds_matches() {
        let (_d, store, id) = windowed_store();
        let res = store
            .body_search("ws", &id, "\"i\": 100", &SearchOpts::default())
            .unwrap();
        assert!(res.total >= 1, "expected a match for an item key");
    }

    #[test]
    fn clearing_removes_side_files() {
        let (_d, store, id) = windowed_store();
        assert!(store.body_window("ws", &id, 0, 1).is_ok());
        store.clear("ws", "req").unwrap();
        // Side file gone → window load now errors.
        assert!(store.body_window("ws", &id, 0, 1).is_err());
    }

    #[test]
    fn jsonpath_filter_produces_windowable_result() {
        let (_d, store, id) = windowed_store();
        let res = store.body_filter("ws", &id, "$[5].i").unwrap();
        assert!(res.error.is_none());
        assert_eq!(res.match_count, 1);
        // The filtered result is windowable under the returned key.
        let w = store.body_window("ws", &res.filter_key, 0, 5).unwrap();
        assert_eq!(w.lines.join("\n").trim(), "5");

        // Invalid JSONPath surfaces an error, not a panic.
        let bad = store.body_filter("ws", &id, "$[").unwrap();
        assert!(bad.error.is_some());

        // Empty query clears the filter file.
        store.body_filter("ws", &id, "").unwrap();
        assert!(store.body_window("ws", &res.filter_key, 0, 1).is_err());
    }
}
