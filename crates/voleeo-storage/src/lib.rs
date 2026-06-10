use voleeo_core::VoleeoError;

/// Reject ids that could escape the storage root before they reach `Path::join`.
/// Generated ids are `[A-Za-z0-9]`; we also allow `_`/`-` for prefixed ids
/// (`ck_…`, `default`) and impose a length cap so a hostile caller can't smuggle
/// `..`, `/`, or an absolute path through the workspace/request/jar id fields.
pub(crate) fn validate_id(id: &str) -> Result<(), VoleeoError> {
    if id.is_empty() || id.len() > 128 {
        return Err(VoleeoError::InvalidConfig(format!("invalid id: {id:?}")));
    }
    if id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Ok(())
    } else {
        Err(VoleeoError::InvalidConfig(format!("invalid id: {id:?}")))
    }
}

pub mod body_window;
pub mod cookies;
pub mod environment;
pub mod request;
pub mod response;
pub mod selection;
pub mod workspace;
pub mod ws;
pub mod ws_transcript;

pub use body_window::{BodyFilterResult, BodyMatch, BodySearchResult, BodyWindow, SearchOpts};
pub use cookies::{CookieJarStore, DEFAULT_JAR_ID};
pub use environment::{EnvironmentStore, GLOBAL_ENV_ID};
pub use request::RequestStore;
pub use response::{ResponseStore, StoredHttpResponse, StoredHttpResponseSummary};
pub use selection::SelectionStore;
pub use workspace::WorkspaceStore;
pub use ws::WsStore;
pub use ws_transcript::{StoredWsSession, StoredWsSessionSummary, WsTranscriptStore};
