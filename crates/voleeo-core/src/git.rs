use serde::{Deserialize, Serialize};
use specta::Type;

use crate::cookies::CookieJar;
use crate::types::{ApiFolder, Environment, GrpcRequest, HttpRequest, Workspace, WsConnection};

/// How a tracked file changed relative to HEAD / the index.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitChange {
    Added,
    Modified,
    Deleted,
    Renamed,
    Conflicted,
    Untracked,
}

/// Which Voleeo entity a changed file maps to, derived from its filename.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitNodeKind {
    Workspace,
    Folder,
    Request,
    WebSocket,
    Grpc,
    Jar,
    Env,
    Other,
}

/// One changed file, already mapped back to its tree node when possible.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub node_id: Option<String>,
    pub node_kind: GitNodeKind,
    pub change: GitChange,
    pub staged: bool,
    /// Parent folder id for a DELETED entity, recovered from its HEAD YAML (the
    /// working file is gone, so the frontend can't resolve it from live state).
    /// `None` for non-deletions, root-level items, and non-foldered kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

/// Snapshot of repo-level state for the Source Control header + init flow.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub has_remote: bool,
    pub remotes: Vec<GitRemoteInfo>,
    pub ahead: u32,
    pub behind: u32,
    pub merging: bool,
    pub has_author: bool,
    pub encrypted: bool,
    pub unencrypted_secrets: bool,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub files: Vec<GitFileChange>,
    pub conflicted: bool,
}

/// A parsed, decrypted workspace entity at one git revision. Exactly one field
/// is `Some`, matching `kind`. Built by the command layer (it owns the crypto);
/// `voleeo-git` only ever deals in the raw YAML text behind it.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitEntity {
    pub kind: GitNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<HttpRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<WsConnection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grpc: Option<GrpcRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<ApiFolder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<Environment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jar: Option<CookieJar>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Workspace>,
}

impl GitEntity {
    /// An empty snapshot of the given kind; the caller sets the matching field.
    pub fn new(kind: GitNodeKind) -> Self {
        Self {
            kind,
            request: None,
            connection: None,
            grpc: None,
            folder: None,
            environment: None,
            jar: None,
            workspace: None,
        }
    }
}

/// A single changed entity for the friendly "Review changes" screen. `old` is the
/// committed (HEAD) snapshot, `new` the working-tree snapshot — both decrypted so
/// ciphertext nonce churn never shows as a change. `None` on the side where the
/// entity does not exist (added ⇒ no old, deleted ⇒ no new).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitEntityChange {
    pub path: String,
    pub node_id: Option<String>,
    pub node_kind: GitNodeKind,
    pub status: GitChange,
    pub old: Option<GitEntity>,
    pub new: Option<GitEntity>,
}

/// A conflicted entity's three sides, parsed + decrypted from the index stages.
/// `None` where that stage is absent (e.g. delete/modify conflicts).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitEntityConflict {
    pub path: String,
    pub node_id: Option<String>,
    pub node_kind: GitNodeKind,
    pub base: Option<GitEntity>,
    pub ours: Option<GitEntity>,
    pub theirs: Option<GitEntity>,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    pub timestamp: f64,
}

/// Outcome of a pull: either fast-forwarded cleanly or left conflicts to resolve.
/// The conflicting entities are loaded separately via `git_entity_conflicts`.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeResult {
    pub fast_forwarded: bool,
    pub conflicted: bool,
    pub up_to_date: bool,
}
