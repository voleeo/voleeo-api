//! Core types → Voleeo Bundle: one self-contained, lossless YAML holding every
//! selected workspace and all its contents (HTTP/WS/gRPC, folders, environments,
//! auth/headers/DNS). The reverse of the desktop's native import.
//!
//! The file is plaintext, so each workspace is sanitized: encryption is turned
//! off, machine-local fields (syncDir/keyCheck) are dropped, and every secret's
//! `*_encrypted` flag is cleared so flags and values agree.

use voleeo_core::{VoleeoBundle, VoleeoError, VoleeoWorkspace, VOLEEO_BUNDLE_VERSION};

use crate::{Bundle, ExportResult};

pub fn to_voleeo(bundles: &[Bundle]) -> Result<ExportResult, VoleeoError> {
    let doc = VoleeoBundle {
        voleeo_bundle: VOLEEO_BUNDLE_VERSION.to_string(),
        workspaces: bundles.iter().map(workspace_doc).collect(),
    };
    Ok(ExportResult {
        content: serde_yaml::to_string(&doc).map_err(|e| VoleeoError::Storage(e.to_string()))?,
        warnings: Vec::new(),
    })
}

fn workspace_doc(b: &Bundle) -> VoleeoWorkspace {
    let mut workspace = b.workspace.clone();
    workspace.encrypted = false;
    workspace.sync_dir = None;
    workspace.key_check = None;
    workspace.auth.mark_secrets_plaintext();

    let mut folders = b.folders.clone();
    for f in &mut folders {
        f.auth.mark_secrets_plaintext();
        for v in &mut f.variables {
            v.encrypted = false;
        }
    }
    let mut requests = b.requests.clone();
    for r in &mut requests {
        r.auth.mark_secrets_plaintext();
    }
    let mut websockets = b.ws.clone();
    for w in &mut websockets {
        w.auth.mark_secrets_plaintext();
    }
    let mut grpc = b.grpc.clone();
    for g in &mut grpc {
        g.auth.mark_secrets_plaintext();
    }
    let mut environments = b.environments.clone();
    for e in &mut environments {
        for v in &mut e.variables {
            v.encrypted = false;
        }
    }

    VoleeoWorkspace {
        workspace,
        folders,
        requests,
        websockets,
        grpc,
        environments,
    }
}
