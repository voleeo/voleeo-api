//! Per-connection session history at
//! `{app_data_dir}/responses-local/{workspace_id}/ws_{connection_id}.yaml`.
//! Newest-first `Vec<StoredWsSession>`, capped by [`SESSION_CAP`]. Each
//! connect opens a fresh session. WS analog of `ResponseStore`.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, TimelineEvent, VoleeoError, WsMessage};

/// Max retained sessions per connection, and per-session message/event caps.
const SESSION_CAP: usize = 20;
const MESSAGE_CAP: usize = 500;
const EVENT_CAP: usize = 500;

fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// One connection session: everything exchanged between a connect and its close.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredWsSession {
    pub id: String,
    #[serde(default)]
    pub connection_id: String,
    #[serde(default)]
    pub recorded_at: String,
    #[serde(default)]
    pub messages: Vec<WsMessage>,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
}

/// Lightweight session summary for the history picker.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredWsSessionSummary {
    pub id: String,
    pub recorded_at: String,
    pub message_count: u32,
    pub event_count: u32,
}

#[derive(Clone)]
pub struct WsTranscriptStore {
    responses_local_dir: PathBuf,
}

impl WsTranscriptStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let responses_local_dir = app_data_dir.as_ref().join("responses-local");
        std::fs::create_dir_all(&responses_local_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            responses_local_dir,
        })
    }

    fn file_path(&self, workspace_id: &str, connection_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(connection_id)?;
        Ok(self
            .responses_local_dir
            .join(workspace_id)
            .join(format!("ws_{connection_id}.yaml")))
    }

    fn read(&self, workspace_id: &str, connection_id: &str) -> Vec<StoredWsSession> {
        let Ok(path) = self.file_path(workspace_id, connection_id) else {
            return Vec::new();
        };
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_yaml::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write(
        &self,
        workspace_id: &str,
        connection_id: &str,
        sessions: &[StoredWsSession],
    ) -> Result<(), VoleeoError> {
        let path = self.file_path(workspace_id, connection_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let content =
            serde_yaml::to_string(sessions).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
    }

    /// Open a fresh session (newest), trimming old ones. Returns the session id.
    pub fn start_session(
        &self,
        workspace_id: &str,
        connection_id: &str,
    ) -> Result<String, VoleeoError> {
        let mut sessions = self.read(workspace_id, connection_id);
        let id = new_id();
        sessions.insert(
            0,
            StoredWsSession {
                id: id.clone(),
                connection_id: connection_id.to_string(),
                recorded_at: now_iso(),
                messages: vec![],
                events: vec![],
            },
        );
        sessions.truncate(SESSION_CAP);
        self.write(workspace_id, connection_id, &sessions)?;
        Ok(id)
    }

    fn ensure_session<'a>(
        sessions: &'a mut Vec<StoredWsSession>,
        connection_id: &str,
    ) -> &'a mut StoredWsSession {
        if sessions.is_empty() {
            sessions.insert(
                0,
                StoredWsSession {
                    id: new_id(),
                    connection_id: connection_id.to_string(),
                    recorded_at: now_iso(),
                    ..Default::default()
                },
            );
        }
        &mut sessions[0]
    }

    pub fn append_message(
        &self,
        workspace_id: &str,
        connection_id: &str,
        message: WsMessage,
    ) -> Result<(), VoleeoError> {
        let mut sessions = self.read(workspace_id, connection_id);
        let session = Self::ensure_session(&mut sessions, connection_id);
        session.messages.push(message);
        let len = session.messages.len();
        if len > MESSAGE_CAP {
            session.messages.drain(0..len - MESSAGE_CAP);
        }
        self.write(workspace_id, connection_id, &sessions)
    }

    pub fn append_event(
        &self,
        workspace_id: &str,
        connection_id: &str,
        event: TimelineEvent,
    ) -> Result<(), VoleeoError> {
        let mut sessions = self.read(workspace_id, connection_id);
        let session = Self::ensure_session(&mut sessions, connection_id);
        session.events.push(event);
        let len = session.events.len();
        if len > EVENT_CAP {
            session.events.drain(0..len - EVENT_CAP);
        }
        self.write(workspace_id, connection_id, &sessions)
    }

    /// The current (newest) session, or an empty one if none exist yet.
    pub fn latest(&self, workspace_id: &str, connection_id: &str) -> StoredWsSession {
        self.read(workspace_id, connection_id)
            .into_iter()
            .next()
            .unwrap_or_else(|| StoredWsSession {
                connection_id: connection_id.to_string(),
                ..Default::default()
            })
    }

    pub fn list_sessions(
        &self,
        workspace_id: &str,
        connection_id: &str,
    ) -> Vec<StoredWsSessionSummary> {
        self.read(workspace_id, connection_id)
            .into_iter()
            .map(|s| StoredWsSessionSummary {
                id: s.id,
                recorded_at: s.recorded_at,
                message_count: s.messages.len() as u32,
                event_count: s.events.len() as u32,
            })
            .collect()
    }

    pub fn get_session(
        &self,
        workspace_id: &str,
        connection_id: &str,
        session_id: &str,
    ) -> Option<StoredWsSession> {
        self.read(workspace_id, connection_id)
            .into_iter()
            .find(|s| s.id == session_id)
    }

    pub fn clear(&self, workspace_id: &str, connection_id: &str) -> Result<(), VoleeoError> {
        let path = self.file_path(workspace_id, connection_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), VoleeoError> {
        crate::validate_id(workspace_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?
            .flatten()
        {
            let name = entry.file_name();
            let filename = name.to_string_lossy();
            if filename.starts_with("ws_") && filename.ends_with(".yaml") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{WsDirection, WsMessageKind};

    fn msg(data: &str) -> WsMessage {
        WsMessage {
            id: new_id(),
            direction: WsDirection::Incoming,
            kind: WsMessageKind::Text,
            data: data.into(),
            size: data.len() as u32,
            at: "2024-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn sessions_isolate_messages() {
        let dir = tempfile::tempdir().unwrap();
        let s = WsTranscriptStore::new(dir.path()).unwrap();
        let s1 = s.start_session("ws", "c1").unwrap();
        s.append_message("ws", "c1", msg("a")).unwrap();
        let s2 = s.start_session("ws", "c1").unwrap();
        s.append_message("ws", "c1", msg("b")).unwrap();

        assert_ne!(s1, s2);
        // Latest is the second session, holding only "b".
        let latest = s.latest("ws", "c1");
        assert_eq!(latest.id, s2);
        assert_eq!(latest.messages.len(), 1);
        assert_eq!(latest.messages[0].data, "b");

        let sessions = s.list_sessions("ws", "c1");
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, s2); // newest first
        assert_eq!(
            s.get_session("ws", "c1", &s1).unwrap().messages[0].data,
            "a"
        );
    }

    #[test]
    fn session_ring_buffer_caps() {
        let dir = tempfile::tempdir().unwrap();
        let s = WsTranscriptStore::new(dir.path()).unwrap();
        for _ in 0..(SESSION_CAP + 5) {
            s.start_session("ws", "c1").unwrap();
        }
        assert_eq!(s.list_sessions("ws", "c1").len(), SESSION_CAP);
    }

    #[test]
    fn append_without_session_creates_one() {
        let dir = tempfile::tempdir().unwrap();
        let s = WsTranscriptStore::new(dir.path()).unwrap();
        s.append_message("ws", "c1", msg("x")).unwrap();
        assert_eq!(s.latest("ws", "c1").messages.len(), 1);
        assert_eq!(s.list_sessions("ws", "c1").len(), 1);
    }

    #[test]
    fn clear_removes_all_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let s = WsTranscriptStore::new(dir.path()).unwrap();
        s.start_session("ws", "c1").unwrap();
        s.append_message("ws", "c1", msg("x")).unwrap();
        s.clear("ws", "c1").unwrap();
        assert_eq!(s.list_sessions("ws", "c1").len(), 0);
    }
}
