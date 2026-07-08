//! Per-request streaming session history at
//! `{app_data_dir}/responses-local/{workspace_id}/grpc_{request_id}.yaml`.
//! Newest-first `Vec<StoredGrpcSession>`, capped by [`SESSION_CAP`]. Each
//! stream start opens a fresh session. gRPC analog of `WsTranscriptStore`.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use voleeo_core::{new_id, now_iso, GrpcStreamMessage, TimelineEvent, VoleeoError};

const SESSION_CAP: usize = 20;
const MESSAGE_CAP: usize = 500;
const EVENT_CAP: usize = 500;

/// One streaming session: every message + lifecycle event between a stream start
/// and its close.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredGrpcSession {
    pub id: String,
    #[serde(default)]
    pub request_id: String,
    #[serde(default)]
    pub recorded_at: String,
    #[serde(default)]
    pub messages: Vec<GrpcStreamMessage>,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredGrpcSessionSummary {
    pub id: String,
    pub recorded_at: String,
    pub message_count: u32,
    pub event_count: u32,
}

#[derive(Clone)]
pub struct GrpcTranscriptStore {
    responses_local_dir: PathBuf,
}

impl GrpcTranscriptStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, VoleeoError> {
        let responses_local_dir = app_data_dir.as_ref().join("responses-local");
        std::fs::create_dir_all(&responses_local_dir)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?;
        Ok(Self {
            responses_local_dir,
        })
    }

    fn file_path(&self, workspace_id: &str, request_id: &str) -> Result<PathBuf, VoleeoError> {
        crate::validate_id(workspace_id)?;
        crate::validate_id(request_id)?;
        Ok(self
            .responses_local_dir
            .join(workspace_id)
            .join(format!("grpc_{request_id}.yaml")))
    }

    fn read(&self, workspace_id: &str, request_id: &str) -> Vec<StoredGrpcSession> {
        let Ok(path) = self.file_path(workspace_id, request_id) else {
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
        request_id: &str,
        sessions: &[StoredGrpcSession],
    ) -> Result<(), VoleeoError> {
        let path = self.file_path(workspace_id, request_id)?;
        let dir = self.responses_local_dir.join(workspace_id);
        std::fs::create_dir_all(&dir).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        let content =
            serde_yaml::to_string(sessions).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        crate::write_atomic(path, content)
    }

    pub fn start_session(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Result<String, VoleeoError> {
        let mut sessions = self.read(workspace_id, request_id);
        let id = new_id();
        sessions.insert(
            0,
            StoredGrpcSession {
                id: id.clone(),
                request_id: request_id.to_string(),
                recorded_at: now_iso(),
                messages: vec![],
                events: vec![],
            },
        );
        sessions.truncate(SESSION_CAP);
        self.write(workspace_id, request_id, &sessions)?;
        Ok(id)
    }

    fn ensure_session<'a>(
        sessions: &'a mut Vec<StoredGrpcSession>,
        request_id: &str,
    ) -> &'a mut StoredGrpcSession {
        if sessions.is_empty() {
            sessions.insert(
                0,
                StoredGrpcSession {
                    id: new_id(),
                    request_id: request_id.to_string(),
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
        request_id: &str,
        message: GrpcStreamMessage,
    ) -> Result<(), VoleeoError> {
        let mut sessions = self.read(workspace_id, request_id);
        let session = Self::ensure_session(&mut sessions, request_id);
        session.messages.push(message);
        let len = session.messages.len();
        if len > MESSAGE_CAP {
            session.messages.drain(0..len - MESSAGE_CAP);
        }
        self.write(workspace_id, request_id, &sessions)
    }

    pub fn append_event(
        &self,
        workspace_id: &str,
        request_id: &str,
        event: TimelineEvent,
    ) -> Result<(), VoleeoError> {
        let mut sessions = self.read(workspace_id, request_id);
        let session = Self::ensure_session(&mut sessions, request_id);
        session.events.push(event);
        let len = session.events.len();
        if len > EVENT_CAP {
            session.events.drain(0..len - EVENT_CAP);
        }
        self.write(workspace_id, request_id, &sessions)
    }

    pub fn latest(&self, workspace_id: &str, request_id: &str) -> StoredGrpcSession {
        self.read(workspace_id, request_id)
            .into_iter()
            .next()
            .unwrap_or_else(|| StoredGrpcSession {
                request_id: request_id.to_string(),
                ..Default::default()
            })
    }

    pub fn list_sessions(
        &self,
        workspace_id: &str,
        request_id: &str,
    ) -> Vec<StoredGrpcSessionSummary> {
        self.read(workspace_id, request_id)
            .into_iter()
            .map(|s| StoredGrpcSessionSummary {
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
        request_id: &str,
        session_id: &str,
    ) -> Option<StoredGrpcSession> {
        self.read(workspace_id, request_id)
            .into_iter()
            .find(|s| s.id == session_id)
    }

    pub fn clear(&self, workspace_id: &str, request_id: &str) -> Result<(), VoleeoError> {
        let path = self.file_path(workspace_id, request_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| VoleeoError::Storage(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::WsDirection;

    fn msg(data: &str) -> GrpcStreamMessage {
        GrpcStreamMessage {
            id: new_id(),
            direction: WsDirection::Incoming,
            data: data.into(),
            size: data.len() as u32,
            at: "2024-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn sessions_isolate_messages() {
        let dir = tempfile::tempdir().unwrap();
        let s = GrpcTranscriptStore::new(dir.path()).unwrap();
        let s1 = s.start_session("ws", "g1").unwrap();
        s.append_message("ws", "g1", msg("a")).unwrap();
        let s2 = s.start_session("ws", "g1").unwrap();
        s.append_message("ws", "g1", msg("b")).unwrap();

        assert_ne!(s1, s2);
        let latest = s.latest("ws", "g1");
        assert_eq!(latest.id, s2);
        assert_eq!(latest.messages[0].data, "b");
        assert_eq!(
            s.get_session("ws", "g1", &s1).unwrap().messages[0].data,
            "a"
        );
    }

    #[test]
    fn ring_buffer_caps_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let s = GrpcTranscriptStore::new(dir.path()).unwrap();
        for _ in 0..(SESSION_CAP + 5) {
            s.start_session("ws", "g1").unwrap();
        }
        assert_eq!(s.list_sessions("ws", "g1").len(), SESSION_CAP);
    }
}
