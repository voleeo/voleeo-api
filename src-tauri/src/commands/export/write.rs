//! Writing export output + companion files to disk.

use std::path::{Path, PathBuf};

use voleeo_core::{ProtoSource, VoleeoError};
use voleeo_export::Bundle;

use super::ExportFormat;

/// Voleeo → one combined YAML at `dest`. Postman → one combined collection at
/// `dest` plus environment files next to it.
pub(super) fn write_output(
    format: ExportFormat,
    bundles: &[Bundle],
    dest: &str,
) -> Result<(Vec<PathBuf>, Vec<String>), VoleeoError> {
    match format {
        ExportFormat::Voleeo => {
            let r = voleeo_export::to_voleeo(bundles)?;
            let path = PathBuf::from(dest);
            write_file(&path, &r.content)?;
            Ok((vec![path], r.warnings))
        }
        ExportFormat::Postman => {
            let r = voleeo_export::to_postman(bundles)?;
            let path = PathBuf::from(dest);
            write_file(&path, &r.content)?;
            let mut paths = vec![path.clone()];
            let dir = path.parent().unwrap_or_else(|| Path::new("."));
            for env in voleeo_export::postman_environments(bundles)? {
                let p = dir.join(format!("{}.postman_environment.json", slug(&env.name)));
                write_file(&p, &env.content)?;
                paths.push(p);
            }
            Ok((paths, r.warnings))
        }
    }
}

/// gRPC → `.proto` (copied from local files, or rendered from reflection) and
/// WS → AsyncAPI documents, written next to the main export.
pub(super) fn write_companions(
    bundles: &[Bundle],
    dest: &str,
    export_proto: bool,
    export_asyncapi: bool,
    reflection_protos: &[voleeo_grpc::ProtoFile],
    paths: &mut Vec<PathBuf>,
) -> Result<(), VoleeoError> {
    let dir = Path::new(dest)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    if export_asyncapi {
        for b in bundles.iter().filter(|b| !b.ws.is_empty()) {
            let r = voleeo_export::to_asyncapi(b)?;
            let path = dir.join(format!("{}.asyncapi.yaml", slug(&b.workspace.name)));
            write_file(&path, &r.content)?;
            paths.push(path);
        }
    }

    if export_proto {
        let mut written = std::collections::HashSet::new();
        // Local .proto files copied verbatim.
        for src in proto_sources(bundles) {
            let Some(name) = Path::new(&src).file_name() else {
                continue;
            };
            if !written.insert(name.to_string_lossy().into_owned()) {
                continue;
            }
            let path = dir.join(name);
            // Best-effort: a missing/moved proto path shouldn't fail the export.
            if std::fs::copy(&src, &path).is_ok() {
                paths.push(path);
            }
        }
        // Reflection-rendered .proto, preserving descriptor paths (so imports
        // resolve). Reject path traversal from an adversarial descriptor name.
        for pf in reflection_protos {
            if pf.path.contains("..") || Path::new(&pf.path).is_absolute() {
                continue;
            }
            if !written.insert(pf.path.clone()) {
                continue;
            }
            let path = dir.join(&pf.path);
            write_file(&path, &pf.content)?;
            paths.push(path);
        }
    }
    Ok(())
}

/// Preview notes for the companion exports (pure — the preview can't touch the
/// network or disk). Reflection-based gRPC requests need a live server at export
/// time, so flag that expectation up front.
pub(super) fn companion_notes(bundles: &[Bundle], export_proto: bool) -> Vec<String> {
    let mut notes = Vec::new();
    if export_proto {
        let reflection = bundles
            .iter()
            .flat_map(|b| &b.grpc)
            .filter(|g| matches!(g.proto_source, ProtoSource::Reflection))
            .count();
        if reflection > 0 {
            notes.push(format!(
                "{reflection} gRPC request(s) use server reflection — Voleeo will fetch their schema from the live server at export and write it as a .proto. Any server it can't reach is skipped."
            ));
        }
    }
    notes
}

/// Local `.proto` file paths referenced by Files-based gRPC requests.
fn proto_sources(bundles: &[Bundle]) -> Vec<String> {
    let mut out = Vec::new();
    for b in bundles {
        for g in &b.grpc {
            if let ProtoSource::Files { paths, .. } = &g.proto_source {
                out.extend(paths.iter().cloned());
            }
        }
    }
    out
}

fn write_file(path: &Path, content: &str) -> Result<(), VoleeoError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| VoleeoError::Storage(e.to_string()))?;
    }
    std::fs::write(path, content).map_err(|e| VoleeoError::Storage(e.to_string()))
}

/// Filesystem-safe slug from a workspace name; falls back to "workspace".
fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "workspace".into()
    } else {
        s
    }
}
