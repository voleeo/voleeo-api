//! Shared entity (de)serialization for the git commands: parse + decrypt blobs
//! into typed entities, and the inverse for write-back.

use crate::commands::request::{transform_auth_secrets, transform_var_secrets, Direction, Stores};
use voleeo_core::{
    ApiFolder, CookieJar, Environment, GitEntity, GitEntityChange, GitNodeKind, GrpcRequest,
    HttpRequest, VoleeoError, Workspace, WsConnection,
};
use voleeo_crypto as workspace_key;

/// Parse + decrypt raw changed blobs into typed entity changes (shared by the
/// pending-changes review and the commit-history viewer).
pub(super) fn blobs_to_changes(
    blobs: Vec<voleeo_git::ChangedBlob>,
    workspace_id: &str,
    stores: &Stores,
) -> Result<Vec<GitEntityChange>, VoleeoError> {
    // Snapshots store ciphertext at rest; decrypt their frozen response/request
    // for this read-only display (never on the conflict-write path). Built once.
    let snapshots =
        voleeo_storage::SnapshotStore::new(&stores.app_data_dir, stores.workspaces.clone())?;
    let decrypt_snapshot = |e: Option<GitEntity>| -> Option<GitEntity> {
        let mut e = e?;
        if let Some(s) = e.snapshot.take() {
            e.snapshot = Some(snapshots.decrypt_for_display(workspace_id, s));
        }
        Some(e)
    };

    let mut out = Vec::new();
    for b in blobs {
        if matches!(b.node_kind, GitNodeKind::Other) {
            continue;
        }
        let old = decrypt_snapshot(parse_entity(
            b.node_kind,
            b.head.as_deref(),
            workspace_id,
            stores,
        )?);
        let new = decrypt_snapshot(parse_entity(
            b.node_kind,
            b.work.as_deref(),
            workspace_id,
            stores,
        )?);
        out.push(GitEntityChange {
            path: b.path,
            node_id: b.node_id,
            node_kind: b.node_kind,
            status: b.change,
            old,
            new,
        });
    }
    Ok(out)
}

/// Deserialize one entity YAML (a HEAD blob or working file) and decrypt its
/// secrets for display. `None` when the side is absent or the YAML can't parse.
pub(super) fn parse_entity(
    kind: GitNodeKind,
    yaml: Option<&str>,
    workspace_id: &str,
    stores: &Stores,
) -> Result<Option<GitEntity>, VoleeoError> {
    let Some(yaml) = yaml else { return Ok(None) };
    let mut entity = GitEntity::new(kind);
    match kind {
        GitNodeKind::Request => {
            let Ok(mut r) = serde_yaml::from_str::<HttpRequest>(yaml) else {
                return Ok(None);
            };
            transform_auth_secrets(&mut r.auth, workspace_id, stores, Direction::Decrypt)?;
            entity.request = Some(r);
        }
        GitNodeKind::WebSocket => {
            let Ok(mut c) = serde_yaml::from_str::<WsConnection>(yaml) else {
                return Ok(None);
            };
            transform_auth_secrets(&mut c.auth, workspace_id, stores, Direction::Decrypt)?;
            entity.connection = Some(c);
        }
        GitNodeKind::Grpc => {
            let Ok(mut g) = serde_yaml::from_str::<GrpcRequest>(yaml) else {
                return Ok(None);
            };
            transform_auth_secrets(&mut g.auth, workspace_id, stores, Direction::Decrypt)?;
            entity.grpc = Some(g);
        }
        GitNodeKind::Folder => {
            let Ok(mut f) = serde_yaml::from_str::<ApiFolder>(yaml) else {
                return Ok(None);
            };
            transform_auth_secrets(&mut f.auth, workspace_id, stores, Direction::Decrypt)?;
            transform_var_secrets(&mut f.variables, workspace_id, stores, Direction::Decrypt)?;
            entity.folder = Some(f);
        }
        GitNodeKind::Env => {
            let Ok(mut e) = serde_yaml::from_str::<Environment>(yaml) else {
                return Ok(None);
            };
            transform_var_secrets(&mut e.variables, workspace_id, stores, Direction::Decrypt)?;
            entity.environment = Some(e);
        }
        GitNodeKind::Jar => {
            let Ok(mut jar) = serde_yaml::from_str::<CookieJar>(yaml) else {
                return Ok(None);
            };
            transform_cookies(&mut jar, workspace_id, stores, Direction::Decrypt)?;
            entity.jar = Some(jar);
        }
        GitNodeKind::Workspace => {
            let Ok(mut ws) = serde_yaml::from_str::<Workspace>(yaml) else {
                return Ok(None);
            };
            transform_auth_secrets(&mut ws.auth, workspace_id, stores, Direction::Decrypt)?;
            entity.workspace = Some(ws);
        }
        // Round-trip the ciphertext untouched here — this is the shared parse
        // used by conflict resolution, whose write path (`encrypt_entity`) has no
        // snapshot re-encryption. `blobs_to_changes` decrypts for the read-only
        // review/history display instead.
        GitNodeKind::Snapshot => {
            let Ok(p) = serde_yaml::from_str::<voleeo_core::Snapshot>(yaml) else {
                return Ok(None);
            };
            entity.snapshot = Some(p);
        }
        GitNodeKind::Other => return Ok(None),
    }
    Ok(Some(entity))
}

/// Re-encrypt a user-merged entity's secrets at rest before it's written back.
pub(super) fn encrypt_entity(
    entity: &mut GitEntity,
    workspace_id: &str,
    stores: &Stores,
) -> Result<(), VoleeoError> {
    if let Some(r) = entity.request.as_mut() {
        transform_auth_secrets(&mut r.auth, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(c) = entity.connection.as_mut() {
        transform_auth_secrets(&mut c.auth, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(g) = entity.grpc.as_mut() {
        transform_auth_secrets(&mut g.auth, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(f) = entity.folder.as_mut() {
        transform_auth_secrets(&mut f.auth, workspace_id, stores, Direction::Encrypt)?;
        transform_var_secrets(&mut f.variables, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(e) = entity.environment.as_mut() {
        transform_var_secrets(&mut e.variables, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(jar) = entity.jar.as_mut() {
        transform_cookies(jar, workspace_id, stores, Direction::Encrypt)?;
    }
    if let Some(ws) = entity.workspace.as_mut() {
        transform_auth_secrets(&mut ws.auth, workspace_id, stores, Direction::Encrypt)?;
    }
    Ok(())
}

/// Encrypt/decrypt a jar's `value_encrypted` cookies with the workspace key.
fn transform_cookies(
    jar: &mut CookieJar,
    workspace_id: &str,
    stores: &Stores,
    direction: Direction,
) -> Result<(), VoleeoError> {
    if !voleeo_cookies::crypto::jar_needs_key(&jar.cookies) {
        return Ok(());
    }
    // workspace.yaml can be unparseable mid-merge; encrypted cookie values imply
    // an encrypted workspace, so assume so rather than failing the conflict load.
    let encrypted = stores
        .workspaces
        .get(workspace_id)
        .map(|ws| ws.encrypted)
        .unwrap_or(true);
    if !encrypted {
        return Ok(());
    }
    let key = workspace_key::load_key(workspace_id, &stores.app_data_dir)?;
    match direction {
        Direction::Decrypt => voleeo_cookies::crypto::decrypt_values(&mut jar.cookies, &key),
        Direction::Encrypt => voleeo_cookies::crypto::encrypt_values(&mut jar.cookies, &key),
    }
}

/// Serialize the populated side of a `GitEntity` to its on-disk YAML form.
pub(super) fn entity_to_yaml(entity: &GitEntity) -> Result<String, VoleeoError> {
    let yaml = match entity.kind {
        GitNodeKind::Request => entity.request.as_ref().map(serde_yaml::to_string),
        GitNodeKind::WebSocket => entity.connection.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Grpc => entity.grpc.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Folder => entity.folder.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Env => entity.environment.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Jar => entity.jar.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Workspace => entity.workspace.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Snapshot => entity.snapshot.as_ref().map(serde_yaml::to_string),
        GitNodeKind::Other => None,
    };
    yaml.ok_or_else(|| VoleeoError::Git("resolved entity has no body".into()))?
        .map_err(|e| VoleeoError::Git(format!("serialize merged entity: {e}")))
}
