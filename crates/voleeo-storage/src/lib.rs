use voleeo_core::VoleeoError;

/// Reject ids that could escape the storage root before they reach `Path::join`.
/// Generated ids are `[A-Za-z0-9]`; we also allow `_`/`-` for prefixed ids
/// (`ck_…`, `default`) and impose a length cap so a hostile caller can't smuggle
/// `..`, `/`, or an absolute path through the workspace/request/jar id fields.
pub fn validate_id(id: &str) -> Result<(), VoleeoError> {
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

/// Write via temp-file + rename so a crash mid-write leaves the old file
/// intact instead of a truncated one (read paths treat corrupt YAML as empty,
/// so a torn write would silently drop the file's data).
pub(crate) fn write_atomic(
    path: impl AsRef<std::path::Path>,
    content: impl AsRef<[u8]>,
) -> Result<(), VoleeoError> {
    use std::io::Write;
    let path = path.as_ref();
    let tmp = path.with_extension("tmp");
    let err = |e: std::io::Error| VoleeoError::Storage(e.to_string());
    let mut f = std::fs::File::create(&tmp).map_err(err)?;
    f.write_all(content.as_ref()).map_err(err)?;
    f.sync_all().map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
}

pub mod body_window;
pub mod cookies;
pub mod environment;
pub mod grpc;
pub mod grpc_response;
pub mod grpc_transcript;
pub mod request;
pub mod response;
pub mod selection;
pub mod workspace;
pub mod ws;
pub mod ws_transcript;

pub use body_window::{BodyFilterResult, BodyMatch, BodySearchResult, BodyWindow, SearchOpts};
pub use cookies::{CookieJarStore, DEFAULT_JAR_ID};
pub use environment::{EnvironmentStore, GLOBAL_ENV_ID};
pub use grpc::{GrpcStore, GrpcUpdate};
pub use grpc_response::{GrpcResponseStore, StoredGrpcResponse, StoredGrpcResponseSummary};
pub use grpc_transcript::{GrpcTranscriptStore, StoredGrpcSession, StoredGrpcSessionSummary};
pub use request::RequestStore;
pub use response::{ResponseStore, StoredHttpResponse, StoredHttpResponseSummary};
pub use selection::SelectionStore;
pub use workspace::WorkspaceStore;
pub use ws::WsStore;
pub use ws_transcript::{StoredWsSession, StoredWsSessionSummary, WsTranscriptStore};
