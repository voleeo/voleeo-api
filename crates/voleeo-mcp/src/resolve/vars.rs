//! Env/folder variable loading and `{{ VAR }}` string resolution — the shared
//! substrate `http`/`grpc` build request application on top of. Only plain
//! `{{ VAR }}` tokens resolve; function tokens (`{{ uuid.v4() }}`) pass through.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use voleeo_core::{ApiFolder, Environment, EnvironmentKind, RequestParameter};
use voleeo_storage::EnvironmentStore;

/// Globals merged with the personal env at `env_id` (personal shadows). Undecryptable
/// values are left as ciphertext rather than failing the whole send.
pub fn load_env_vars(
    environments: &EnvironmentStore,
    workspace_id: &str,
    env_id: Option<&str>,
    app_data_dir: &Path,
) -> HashMap<String, String> {
    let envs = match environments.list(workspace_id) {
        Ok(e) => e,
        Err(_) => return HashMap::new(),
    };
    load_env_vars_from(&envs, workspace_id, env_id, app_data_dir)
}

/// `load_env_vars` variant — skip the disk read when the caller already has the list.
pub fn load_env_vars_from(
    envs: &[Environment],
    workspace_id: &str,
    env_id: Option<&str>,
    app_data_dir: &Path,
) -> HashMap<String, String> {
    // File-only: keychain access blocks 60+s in headless contexts (no UI to
    // authorize). `save_key` always mirrors to disk, so this is safe.
    let key = voleeo_crypto::load_key_from_file(workspace_id, app_data_dir).ok();

    let decrypt = |value: &str, encrypted: bool| -> String {
        if encrypted {
            if let Some(k) = &key {
                if voleeo_crypto::is_encrypted(value) {
                    return voleeo_crypto::decrypt(value, k).unwrap_or_else(|_| value.to_string());
                }
            }
        }
        value.to_string()
    };

    let mut vars: HashMap<String, String> = envs
        .iter()
        .find(|e| e.kind == EnvironmentKind::Global)
        .map(|e| {
            e.variables
                .iter()
                .filter(|v| v.enabled)
                .map(|v| (v.key.clone(), decrypt(&v.value, v.encrypted)))
                .collect()
        })
        .unwrap_or_default();

    if let Some(id) = env_id {
        if let Some(personal) = envs.iter().find(|e| e.id == id) {
            for v in personal.variables.iter().filter(|v| v.enabled) {
                vars.insert(v.key.clone(), decrypt(&v.value, v.encrypted));
            }
        }
    }

    vars
}

/// root→nearest, cycle-safe. Mirrors TS `ancestorChainRootFirst`.
fn ancestor_chain_root_first(start: Option<&str>, folders: &[ApiFolder]) -> Vec<ApiFolder> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut current = start.map(str::to_string);
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some(f) = folders.iter().find(|f| f.id == id) else {
            break;
        };
        chain.push(f.clone());
        current = f.folder_id.clone();
    }
    chain.reverse();
    chain
}

/// Merge inherited folder/workspace headers into a request's own metadata for
/// gRPC sends. Precedence: own > nearest folder > … > root folder > workspace;
/// deduped case-insensitively by name, disabled rows dropped. The frontend
/// `computeInheritedHeaders` mirrors this ordering for the read-only display.
pub fn merge_inherited_metadata(
    own: &[RequestParameter],
    folder_id: Option<&str>,
    folders: &[ApiFolder],
    workspace_headers: &[RequestParameter],
) -> Vec<RequestParameter> {
    let mut out: Vec<RequestParameter> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut add = |rows: &[RequestParameter]| {
        for r in rows
            .iter()
            .filter(|r| r.enabled && !r.name.trim().is_empty())
        {
            if seen.insert(r.name.to_ascii_lowercase()) {
                out.push(r.clone());
            }
        }
    };
    add(own); // strongest first so it wins on duplicate names
    for f in ancestor_chain_root_first(folder_id, folders)
        .into_iter()
        .rev()
    {
        add(&f.headers);
    }
    add(workspace_headers);
    out
}

/// Layer folder vars over `vars`. Chain inserted root→nearest, so nearest wins.
/// `key` decrypts `encrypted` values; `None` leaves them as ciphertext.
pub fn apply_folder_vars(
    vars: &mut HashMap<String, String>,
    folder_id: Option<&str>,
    folders: &[ApiFolder],
    key: Option<&[u8; 32]>,
) {
    for folder in ancestor_chain_root_first(folder_id, folders) {
        for v in folder.variables.iter().filter(|v| v.enabled) {
            let value = if v.encrypted {
                match key {
                    Some(k) if voleeo_crypto::is_encrypted(&v.value) => {
                        voleeo_crypto::decrypt(&v.value, k).unwrap_or_else(|_| v.value.clone())
                    }
                    _ => v.value.clone(),
                }
            } else {
                v.value.clone()
            };
            vars.insert(v.key.clone(), value);
        }
    }
}

/// Resolve `{{ VAR }}` in `text`. Unresolvable tokens stay verbatim so error
/// messages name them. Transitive resolution with a cycle guard.
pub fn resolve_str(text: &str, vars: &HashMap<String, String>) -> String {
    resolve_inner(text, vars, &mut HashSet::new())
}

fn resolve_inner(
    text: &str,
    vars: &HashMap<String, String>,
    visited: &mut HashSet<String>,
) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(open) = rest.find("{{") {
        result.push_str(&rest[..open]);
        rest = &rest[open + 2..];

        let Some(close) = rest.find("}}") else {
            result.push_str("{{");
            result.push_str(rest);
            return result;
        };

        let inner = rest[..close].trim();
        rest = &rest[close + 2..];

        if is_identifier(inner) {
            if visited.contains(inner) {
                push_token(&mut result, inner); // cycle guard
            } else if let Some(val) = vars.get(inner) {
                visited.insert(inner.to_string());
                let resolved = resolve_inner(val, vars, visited);
                visited.remove(inner);
                result.push_str(&resolved);
            } else {
                push_token(&mut result, inner); // missing — keep verbatim
            }
        } else {
            push_token(&mut result, inner); // function call or unknown — keep verbatim
        }
    }

    result.push_str(rest);
    result
}

pub(super) fn is_identifier(s: &str) -> bool {
    // POSIX env-var convention: letter/underscore first, then letters, digits
    // and `_` (matches `EnvVarKeySchema`). No hyphens, never a leading digit.
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_alphabetic() || c == '_')
        && chars.all(|c| c.is_alphanumeric() || c == '_')
}

fn push_token(out: &mut String, inner: &str) {
    out.push_str("{{ ");
    out.push_str(inner);
    out.push_str(" }}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn resolves_simple_var() {
        let v = vars(&[("HOST", "https://api.example.com")]);
        assert_eq!(
            resolve_str("{{ HOST }}/path", &v),
            "https://api.example.com/path"
        );
    }

    #[test]
    fn leaves_missing_var_verbatim() {
        let v = vars(&[]);
        assert_eq!(resolve_str("{{ MISSING }}", &v), "{{ MISSING }}");
    }

    #[test]
    fn leaves_function_verbatim() {
        assert_eq!(
            resolve_str("{{ uuid.v4() }}", &vars(&[])),
            "{{ uuid.v4() }}"
        );
    }

    #[test]
    fn transitive_resolution() {
        let v = vars(&[("BASE", "{{ HOST }}/api"), ("HOST", "https://example.com")]);
        assert_eq!(resolve_str("{{ BASE }}", &v), "https://example.com/api");
    }

    #[test]
    fn cycle_guard() {
        let v = vars(&[("A", "{{ B }}"), ("B", "{{ A }}")]);
        let result = resolve_str("{{ A }}", &v);
        // Should not hang or panic — cycle is broken.
        assert!(result.contains("{{ A }}") || result.contains("{{ B }}"));
    }

    fn env(id: &str, kind: EnvironmentKind, vars: &[(&str, &str, bool)]) -> Environment {
        Environment {
            id: id.into(),
            workspace_id: "ws".into(),
            kind,
            name: id.into(),
            color: String::new(),
            shared: false,
            variables: vars
                .iter()
                .map(|(k, v, enabled)| voleeo_core::EnvironmentVariable {
                    key: k.to_string(),
                    value: v.to_string(),
                    encrypted: false,
                    enabled: *enabled,
                })
                .collect(),
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn load_env_vars_global_only() {
        let dir = tmp_dir();
        let envs = vec![env(
            "global",
            EnvironmentKind::Global,
            &[("HOST", "https://api.example.com", true)],
        )];
        let result = load_env_vars_from(&envs, "ws", None, dir.path());
        assert_eq!(
            result.get("HOST").map(String::as_str),
            Some("https://api.example.com")
        );
    }

    #[test]
    fn load_env_vars_personal_overrides_global() {
        let dir = tmp_dir();
        let envs = vec![
            env(
                "global",
                EnvironmentKind::Global,
                &[
                    ("TOKEN", "global-token", true),
                    ("BASE", "global-base", true),
                ],
            ),
            env(
                "dev",
                EnvironmentKind::Personal,
                &[("TOKEN", "dev-token", true)],
            ),
        ];
        let result = load_env_vars_from(&envs, "ws", Some("dev"), dir.path());
        assert_eq!(
            result["TOKEN"], "dev-token",
            "personal should override global"
        );
        assert_eq!(
            result["BASE"], "global-base",
            "non-overridden global var should remain"
        );
    }

    #[test]
    fn load_env_vars_disabled_vars_excluded() {
        let dir = tmp_dir();
        let envs = vec![env(
            "global",
            EnvironmentKind::Global,
            &[("ACTIVE", "yes", true), ("INACTIVE", "no", false)],
        )];
        let result = load_env_vars_from(&envs, "ws", None, dir.path());
        assert!(result.contains_key("ACTIVE"));
        assert!(!result.contains_key("INACTIVE"));
    }

    #[test]
    fn load_env_vars_no_env_id_uses_globals_only() {
        let dir = tmp_dir();
        let envs = vec![
            env("global", EnvironmentKind::Global, &[("G", "gval", true)]),
            env(
                "personal",
                EnvironmentKind::Personal,
                &[("P", "pval", true)],
            ),
        ];
        let result = load_env_vars_from(&envs, "ws", None, dir.path());
        assert_eq!(result.get("G").map(String::as_str), Some("gval"));
        assert!(
            !result.contains_key("P"),
            "personal vars should not bleed in without env_id"
        );
    }

    fn folder(id: &str, parent: Option<&str>, vars: &[(&str, &str)]) -> ApiFolder {
        ApiFolder {
            id: id.into(),
            folder_type: "api".into(),
            model: "folder".into(),
            workspace_id: "ws".into(),
            folder_id: parent.map(str::to_string),
            name: id.into(),
            headers: vec![],
            auth: voleeo_core::AuthConfig::None,
            variables: vars
                .iter()
                .map(|(k, v)| voleeo_core::EnvironmentVariable {
                    key: k.to_string(),
                    value: v.to_string(),
                    encrypted: false,
                    enabled: true,
                })
                .collect(),
            color: None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    #[test]
    fn folder_vars_nearest_beats_ancestor_beats_env() {
        let dir = tmp_dir();
        let envs = vec![env(
            "global",
            EnvironmentKind::Global,
            &[("BASE", "env-base", true)],
        )];
        let mut vars = load_env_vars_from(&envs, "ws", None, dir.path());
        let folders = vec![
            folder("root", None, &[("BASE", "root-base"), ("ONLY_ROOT", "r")]),
            folder("child", Some("root"), &[("BASE", "child-base")]),
        ];
        apply_folder_vars(&mut vars, Some("child"), &folders, None);
        assert_eq!(
            vars.get("BASE").map(String::as_str),
            Some("child-base"),
            "nearest folder wins over ancestor and env"
        );
        assert_eq!(
            vars.get("ONLY_ROOT").map(String::as_str),
            Some("r"),
            "ancestor-only var still inherited"
        );
    }
}
