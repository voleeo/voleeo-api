//! Compile local `.proto` files into a `DescriptorPool` at runtime via protox
//! (pure-Rust, no `protoc`). Used by `ProtoSource::Files`.

use prost_reflect::DescriptorPool;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use voleeo_core::VoleeoError;

/// Compile `paths` with `include_dirs` as import roots. When no include dirs are
/// given, each proto's parent directory is used so bare imports still resolve.
pub fn compile(paths: &[String], include_dirs: &[String]) -> Result<DescriptorPool, VoleeoError> {
    if paths.is_empty() {
        return Err(VoleeoError::Grpc("no .proto files selected".into()));
    }
    let includes = resolve_includes(paths, include_dirs);
    let fds = protox::compile(paths, &includes)
        .map_err(|e| VoleeoError::Grpc(format!("proto compile: {e}")))?;
    DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| VoleeoError::Grpc(format!("build descriptor pool: {e}")))
}

fn resolve_includes(paths: &[String], include_dirs: &[String]) -> Vec<PathBuf> {
    if !include_dirs.is_empty() {
        return include_dirs.iter().map(PathBuf::from).collect();
    }
    // Dedup parent dirs (BTreeSet for deterministic order).
    paths
        .iter()
        .filter_map(|p| Path::new(p).parent().map(Path::to_path_buf))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_a_local_proto() {
        let dir = std::env::temp_dir().join(format!("voleeo_protos_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("svc.proto");
        std::fs::write(
            &path,
            "syntax = \"proto3\"; package p; message M { string a = 1; } \
             service S { rpc Call(M) returns (M); }",
        )
        .unwrap();

        let pool = compile(&[path.to_string_lossy().into_owned()], &[]).unwrap();
        assert!(pool.get_service_by_name("p.S").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_paths_errors() {
        assert!(matches!(compile(&[], &[]), Err(VoleeoError::Grpc(_))));
    }
}
