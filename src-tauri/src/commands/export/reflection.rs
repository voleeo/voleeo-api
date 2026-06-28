//! Reflection → `.proto` for export: fetch reflection-based gRPC schemas from the
//! live server and render them, resolving targets against the workspace's env
//! vars first. The one place export touches the network.

use std::collections::{BTreeMap, HashMap};

use voleeo_core::{EnvironmentKind, ProtoSource};
use voleeo_export::Bundle;

/// Render reflection-based gRPC schemas to `.proto`. Returns the rendered files
/// (deduped by descriptor path) and how many requests couldn't be reached.
pub(super) async fn resolve_reflection_protos(
    cache: &voleeo_grpc::DescriptorCache,
    bundles: &[Bundle],
) -> (Vec<voleeo_grpc::ProtoFile>, u32) {
    let mut files: BTreeMap<String, String> = BTreeMap::new();
    let mut failed = 0u32;
    for b in bundles {
        let vars = env_var_map(b);
        for g in b
            .grpc
            .iter()
            .filter(|g| matches!(g.proto_source, ProtoSource::Reflection))
        {
            let target = substitute_vars(&g.target, &vars);
            match cache
                .get_or_build(&g.id, &g.proto_source, &target, g.tls)
                .await
            {
                Ok(resolved) => {
                    for pf in voleeo_grpc::pool_to_files(&resolved.pool) {
                        files.entry(pf.path).or_insert(pf.content);
                    }
                }
                Err(_) => failed += 1,
            }
        }
    }
    let files = files
        .into_iter()
        .map(|(path, content)| voleeo_grpc::ProtoFile { path, content })
        .collect();
    (files, failed)
}

/// Enabled env vars for a bundle, global taking precedence over personal.
fn env_var_map(b: &Bundle) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for global in [false, true] {
        for env in b
            .environments
            .iter()
            .filter(|e| (e.kind == EnvironmentKind::Global) == global)
        {
            for v in env.variables.iter().filter(|v| v.enabled) {
                map.insert(v.key.clone(), v.value.clone());
            }
        }
    }
    map
}

/// Substitute `{{ KEY }}` env-var tokens; unknown tokens are left intact.
fn substitute_vars(text: &str, vars: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        match vars.get(after[..end].trim()) {
            Some(val) => out.push_str(val),
            None => out.push_str(&rest[start..start + 2 + end + 2]),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}
