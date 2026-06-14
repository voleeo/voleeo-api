//! Backend mirror of `sendResolution.ts`. Pipeline is numbered inline in
//! `apply_to_request`. Only plain `{{ VAR }}` tokens resolve; function tokens
//! (`{{ uuid.v4() }}`) pass through so failures carry the literal URL.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use voleeo_core::{
    ApiFolder, ApiKeyLocation, AuthConfig, Environment, EnvironmentKind, HttpRequest,
    RequestParameter, WsConnection,
};
use voleeo_storage::EnvironmentStore;

mod grpc;
mod text;
pub use grpc::{apply_to_grpc, grpc_vars, resolve_grpc_for_send};
use text::{base64_encode, extract_path_params, replace_path_param, strip_query, url_encode};

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

fn is_identifier(s: &str) -> bool {
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

/// Apply full template resolution to a request in-place before execution.
pub fn apply_to_request(req: &mut HttpRequest, vars: &HashMap<String, String>) {
    let path_param_names = extract_path_params(&req.url);

    // 1 & 2: substitute :params then resolve {{ }} in the base URL.
    let base_url = strip_query(&req.url);
    let mut resolved_base = base_url.to_string();
    for param in req
        .parameters
        .iter()
        .filter(|p| p.enabled && path_param_names.contains(&p.name))
    {
        let val = url_encode(&resolve_str(&param.value, vars));
        resolved_base = replace_path_param(&resolved_base, &param.name, &val);
    }
    resolved_base = resolve_str(&resolved_base, vars);

    // 3: build query string from non-path enabled parameters.
    let mut query_parts: Vec<String> = req
        .parameters
        .iter()
        .filter(|p| p.enabled && !p.name.trim().is_empty() && !path_param_names.contains(&p.name))
        .map(|p| {
            let k = url_encode(&resolve_str(&p.name, vars));
            let v = resolve_str(&p.value, vars);
            if v.is_empty() {
                k
            } else {
                format!("{k}={}", url_encode(&v))
            }
        })
        .collect();

    // 4: resolve headers in-place.
    for h in req.headers.iter_mut() {
        if !h.enabled || h.name.trim().is_empty() {
            continue;
        }
        h.name = resolve_str(&h.name, vars);
        h.value = resolve_str(&h.value, vars);
    }

    // 5: resolve body — raw text and form/multipart field values. File paths
    // (multipart file fields, binary) are left untouched.
    if let Some(body) = &mut req.body {
        if !matches!(body.kind, voleeo_core::BodyKind::None) {
            body.text = resolve_str(&body.text, vars);
            if let Some(vars_text) = body.graphql_variables.as_mut() {
                *vars_text = resolve_str(vars_text, vars);
            }
            if let Some(fields) = body.fields.as_mut() {
                for f in fields.iter_mut() {
                    f.name = resolve_str(&f.name, vars);
                    if !f.is_file {
                        f.value = resolve_str(&f.value, vars);
                    }
                }
            }
        }
    }

    // 6: resolve auth. A disabled (toggled-off) scheme applies nothing. Dynamic
    // schemes (SigV4) are signed by the executor over the final request, so we
    // only resolve their `{{ }}` fields in place and leave `req.auth` for the
    // executor. Static schemes become a header/query param here, then `req.auth`
    // is cleared so the executor never re-applies.
    if !req.auth.is_active() {
        req.auth = AuthConfig::None;
    } else if req.auth.is_dynamic() {
        resolve_dynamic_auth(&mut req.auth, vars);
    } else if matches!(req.auth, AuthConfig::OAuth2 { .. }) {
        // Resolve `{{ }}` in place and leave `req.auth` — the async send handler
        // exchanges the cached token for a Bearer header (network/cache access
        // can't happen in this sync resolver).
        resolve_oauth2_auth(&mut req.auth, vars);
    } else {
        match &req.auth.clone() {
            AuthConfig::Bearer { token, .. } => {
                let t = resolve_str(token, vars);
                req.headers
                    .push(auth_header("Authorization", format!("Bearer {t}")));
            }
            AuthConfig::Basic {
                username, password, ..
            } => {
                let u = resolve_str(username, vars);
                let p = resolve_str(password, vars);
                let encoded = base64_encode(format!("{u}:{p}").as_bytes());
                req.headers
                    .push(auth_header("Authorization", format!("Basic {encoded}")));
            }
            AuthConfig::ApiKey {
                key,
                value,
                location,
                ..
            } => {
                let k = resolve_str(key, vars);
                let v = resolve_str(value, vars);
                if !k.trim().is_empty() {
                    match location {
                        ApiKeyLocation::Header => {
                            req.headers.push(auth_header(k, v));
                        }
                        ApiKeyLocation::Query => {
                            query_parts.push(format!("{}={}", url_encode(&k), url_encode(&v)));
                        }
                    }
                }
            }
            // Inherit is resolved by the frontend before sending. When the MCP
            // server sends a stored request directly it has no folder/workspace
            // context, so treat unresolved inherit as "no auth".
            AuthConfig::None | AuthConfig::Inherit { .. } => {}
            // Dynamic schemes are handled above; unreachable here.
            AuthConfig::AwsSigV4 { .. }
            | AuthConfig::OAuth1 { .. }
            | AuthConfig::OAuth2 { .. }
            | AuthConfig::Digest { .. } => {}
        }
        req.auth = AuthConfig::None;
    }

    req.url = if query_parts.is_empty() {
        resolved_base
    } else {
        format!("{}?{}", resolved_base, query_parts.join("&"))
    };
}

/// WS equivalent of `apply_to_request`: resolved URL + handshake headers.
pub fn apply_to_connection(
    conn: &WsConnection,
    vars: &HashMap<String, String>,
) -> (String, Vec<(String, String)>) {
    let path_param_names = extract_path_params(&conn.url);

    // Substitute :params, then resolve {{ }} in the base URL.
    let base_url = strip_query(&conn.url);
    let mut resolved_base = base_url.to_string();
    for param in conn
        .parameters
        .iter()
        .filter(|p| p.enabled && path_param_names.contains(&p.name))
    {
        let val = url_encode(&resolve_str(&param.value, vars));
        resolved_base = replace_path_param(&resolved_base, &param.name, &val);
    }
    resolved_base = resolve_str(&resolved_base, vars);

    // Build query string from non-path enabled parameters.
    let mut query_parts: Vec<String> = conn
        .parameters
        .iter()
        .filter(|p| p.enabled && !p.name.trim().is_empty() && !path_param_names.contains(&p.name))
        .map(|p| {
            let k = url_encode(&resolve_str(&p.name, vars));
            let v = resolve_str(&p.value, vars);
            if v.is_empty() {
                k
            } else {
                format!("{k}={}", url_encode(&v))
            }
        })
        .collect();

    let mut headers: Vec<(String, String)> = conn
        .headers
        .iter()
        .filter(|h| h.enabled && !h.name.trim().is_empty())
        .map(|h| (resolve_str(&h.name, vars), resolve_str(&h.value, vars)))
        .collect();

    // A disabled (toggled-off) scheme applies nothing.
    let none = AuthConfig::None;
    let effective_auth = if conn.auth.is_active() {
        &conn.auth
    } else {
        &none
    };
    match effective_auth {
        AuthConfig::Bearer { token, .. } => {
            headers.push((
                "Authorization".into(),
                format!("Bearer {}", resolve_str(token, vars)),
            ));
        }
        AuthConfig::Basic {
            username, password, ..
        } => {
            let encoded = base64_encode(
                format!(
                    "{}:{}",
                    resolve_str(username, vars),
                    resolve_str(password, vars)
                )
                .as_bytes(),
            );
            headers.push(("Authorization".into(), format!("Basic {encoded}")));
        }
        AuthConfig::ApiKey {
            key,
            value,
            location,
            ..
        } => {
            let k = resolve_str(key, vars);
            let v = resolve_str(value, vars);
            if !k.trim().is_empty() {
                match location {
                    ApiKeyLocation::Header => headers.push((k, v)),
                    ApiKeyLocation::Query => {
                        query_parts.push(format!("{}={}", url_encode(&k), url_encode(&v)));
                    }
                }
            }
        }
        AuthConfig::None | AuthConfig::Inherit { .. } => {}
        // SigV4 is HTTP-only; a WS connection inheriting it sends no auth.
        AuthConfig::AwsSigV4 { .. }
        | AuthConfig::OAuth1 { .. }
        | AuthConfig::OAuth2 { .. }
        | AuthConfig::Digest { .. } => {}
    }

    let url = if query_parts.is_empty() {
        resolved_base
    } else {
        format!("{}?{}", resolved_base, query_parts.join("&"))
    };
    (url, headers)
}

/// Resolve `{{ VAR }}` in every field of a dynamic auth scheme in place. The
/// executor signs the request later using the resolved config. Extend the match
/// as new dynamic schemes are added.
fn resolve_dynamic_auth(auth: &mut AuthConfig, vars: &HashMap<String, String>) {
    match auth {
        AuthConfig::AwsSigV4 {
            access_key,
            secret_key,
            session_token,
            region,
            service,
            ..
        } => {
            *access_key = resolve_str(access_key, vars);
            *secret_key = resolve_str(secret_key, vars);
            *session_token = resolve_str(session_token, vars);
            *region = resolve_str(region, vars);
            *service = resolve_str(service, vars);
        }
        AuthConfig::OAuth1 {
            consumer_key,
            consumer_secret,
            token,
            token_secret,
            realm,
            private_key,
            callback,
            verifier,
            timestamp,
            nonce,
            version,
            ..
        } => {
            *consumer_key = resolve_str(consumer_key, vars);
            *consumer_secret = resolve_str(consumer_secret, vars);
            *token = resolve_str(token, vars);
            *token_secret = resolve_str(token_secret, vars);
            *realm = resolve_str(realm, vars);
            *private_key = resolve_str(private_key, vars);
            *callback = resolve_str(callback, vars);
            *verifier = resolve_str(verifier, vars);
            *timestamp = resolve_str(timestamp, vars);
            *nonce = resolve_str(nonce, vars);
            *version = resolve_str(version, vars);
        }
        AuthConfig::Digest {
            username, password, ..
        } => {
            *username = resolve_str(username, vars);
            *password = resolve_str(password, vars);
        }
        _ => {}
    }
}

/// Resolve `{{ VAR }}` in an OAuth 2.0 config's template fields in place. The
/// async send handler then exchanges the cached token for a Bearer header.
fn resolve_oauth2_auth(auth: &mut AuthConfig, vars: &HashMap<String, String>) {
    if let AuthConfig::OAuth2 {
        auth_url,
        token_url,
        client_id,
        client_secret,
        scope,
        audience,
        username,
        password,
        code_verifier,
        ..
    } = auth
    {
        *auth_url = resolve_str(auth_url, vars);
        *token_url = resolve_str(token_url, vars);
        *client_id = resolve_str(client_id, vars);
        *client_secret = resolve_str(client_secret, vars);
        *scope = resolve_str(scope, vars);
        *audience = resolve_str(audience, vars);
        *username = resolve_str(username, vars);
        *password = resolve_str(password, vars);
        *code_verifier = resolve_str(code_verifier, vars);
    }
}

pub(crate) fn auth_header(name: impl Into<String>, value: impl Into<String>) -> RequestParameter {
    RequestParameter {
        id: "__auth".into(),
        name: name.into(),
        value: value.into(),
        enabled: true,
    }
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

    #[test]
    fn path_param_substitution() {
        assert_eq!(
            replace_path_param("/api/:name/info", "name", "ditto"),
            "/api/ditto/info"
        );
    }

    #[test]
    fn base64_basic() {
        // "man" → "bWFu"
        assert_eq!(base64_encode(b"man"), "bWFu");
        // "Ma" → "TWE="
        assert_eq!(base64_encode(b"Ma"), "TWE=");
    }

    #[test]
    fn url_encode_unreserved_chars_pass_through() {
        let input = "abcABC012-_.~";
        assert_eq!(url_encode(input), input);
    }

    #[test]
    fn url_encode_encodes_space_and_special() {
        assert_eq!(url_encode(" "), "%20");
        assert_eq!(url_encode("a&b=c"), "a%26b%3Dc");
        assert_eq!(url_encode("/"), "%2F");
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
            auth: AuthConfig::None,
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

    fn bare_request(url: &str) -> HttpRequest {
        HttpRequest {
            id: "r1".into(),
            request_type: "http".into(),
            model: "request".into(),
            workspace_id: "ws".into(),
            folder_id: None,
            method: "GET".into(),
            name: "Test".into(),
            url: url.into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    fn param(name: &str, value: &str, enabled: bool) -> RequestParameter {
        RequestParameter {
            id: "p".into(),
            name: name.into(),
            value: value.into(),
            enabled,
        }
    }

    #[test]
    fn apply_path_param_substitution() {
        let v = vars(&[("USER_ID", "42")]);
        let mut req = bare_request("https://api.example.com/users/:id/profile");
        req.parameters = vec![param("id", "{{ USER_ID }}", true)];
        apply_to_request(&mut req, &v);
        assert_eq!(req.url, "https://api.example.com/users/42/profile");
    }

    #[test]
    fn apply_query_params_appended() {
        let v = vars(&[("Q", "hello world")]);
        let mut req = bare_request("https://api.example.com/search");
        req.parameters = vec![param("q", "{{ Q }}", true), param("page", "1", true)];
        apply_to_request(&mut req, &v);
        assert!(
            req.url.contains("q=hello%20world"),
            "query value should be encoded: {}",
            req.url
        );
        assert!(
            req.url.contains("page=1"),
            "second param should appear: {}",
            req.url
        );
    }

    #[test]
    fn apply_disabled_query_params_excluded() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.parameters = vec![param("active", "yes", true), param("ignored", "no", false)];
        apply_to_request(&mut req, &v);
        assert!(req.url.contains("active=yes"));
        assert!(!req.url.contains("ignored"));
    }

    #[test]
    fn apply_bearer_auth_injects_authorization_header() {
        let v = vars(&[("TOKEN", "my-secret")]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Bearer {
            token: "{{ TOKEN }}".into(),
            token_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let auth_header = req.headers.iter().find(|h| h.name == "Authorization");
        assert!(
            auth_header.is_some(),
            "Authorization header should be injected"
        );
        assert_eq!(auth_header.unwrap().value, "Bearer my-secret");
    }

    #[test]
    fn apply_disabled_auth_injects_nothing() {
        let v = vars(&[("TOKEN", "my-secret")]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Bearer {
            token: "{{ TOKEN }}".into(),
            token_encrypted: false,
            enabled: false,
        };
        apply_to_request(&mut req, &v);
        assert!(
            req.headers.iter().all(|h| h.name != "Authorization"),
            "disabled auth must not inject a header"
        );
        assert!(matches!(req.auth, AuthConfig::None));
    }

    #[test]
    fn apply_basic_auth_base64_encodes() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Basic {
            username: "user".into(),
            password: "pass".into(),
            password_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let auth_header = req
            .headers
            .iter()
            .find(|h| h.name == "Authorization")
            .unwrap();
        // "user:pass" → base64 → "dXNlcjpwYXNz"
        assert_eq!(auth_header.value, "Basic dXNlcjpwYXNz");
    }

    #[test]
    fn apply_api_key_as_header() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::ApiKey {
            key: "X-Api-Key".into(),
            value: "secret".into(),
            location: ApiKeyLocation::Header,
            value_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let h = req.headers.iter().find(|h| h.name == "X-Api-Key").unwrap();
        assert_eq!(h.value, "secret");
    }

    #[test]
    fn apply_api_key_as_query_param() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/data");
        req.auth = AuthConfig::ApiKey {
            key: "apikey".into(),
            value: "tok".into(),
            location: ApiKeyLocation::Query,
            value_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        assert!(
            req.url.contains("apikey=tok"),
            "api key should appear in query: {}",
            req.url
        );
    }
}
