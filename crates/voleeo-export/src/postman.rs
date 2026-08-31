//! Core types → Postman Collection v2.1. Selected folder roots become top-level
//! items; unscoped workspaces keep their workspace wrapper. Env vars become flat
//! collection variables (last-wins on key clash). Only HTTP requests go in the
//! collection — gRPC/WebSocket use companion .proto / AsyncAPI files written by
//! the command layer.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{json, Value};
use voleeo_core::{
    ApiFolder, AuthConfig, BodyKind, HttpRequest, InheritSource, RequestBody, RequestParameter,
    VoleeoError,
};

use crate::auth::auth_to_postman;
use crate::{children, normalize_templates, Bundle, ExportResult, NamedFile, Node};

const SCHEMA_2_1: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub fn to_postman(bundles: &[Bundle]) -> Result<ExportResult, VoleeoError> {
    to_postman_with_roots(bundles, &[])
}

/// Export bundles with optional `(workspace_id, folder_id)` collection roots.
/// Selected descendants of another root are emitted only once.
pub fn to_postman_with_roots(
    bundles: &[Bundle],
    roots: &[(String, String)],
) -> Result<ExportResult, VoleeoError> {
    let name = if bundles.len() == 1 {
        let selected = root_folders(&bundles[0], roots);
        if selected.len() == 1 {
            selected[0].name.clone()
        } else {
            bundles[0].workspace.name.clone()
        }
    } else {
        "Voleeo Export".to_string()
    };

    let mut items = Vec::new();
    for bundle in bundles {
        let selected = root_folders(bundle, roots);
        if selected.is_empty() {
            items.push(workspace_item(bundle));
        } else {
            items.extend(
                selected
                    .into_iter()
                    .map(|folder| root_folder_item(bundle, folder)),
            );
        }
    }

    let collection = json!({
        "info": { "name": name, "schema": SCHEMA_2_1 },
        "item": items,
        "variable": collection_variables(bundles),
    });

    let mut warnings = Vec::new();
    if bundles
        .iter()
        .any(|b| b.environments.iter().any(|e| !e.variables.is_empty()))
    {
        warnings.push(
            "Environments are written as separate *.postman_environment.json files next to the collection — import those into Postman too (they appear under Environments, while the collection's own variables are its defaults)."
                .to_string(),
        );
    }

    Ok(ExportResult {
        content: serde_json::to_string_pretty(&collection)
            .map_err(|e| VoleeoError::Storage(e.to_string()))?,
        warnings,
    })
}

fn root_folders<'a>(bundle: &'a Bundle, roots: &[(String, String)]) -> Vec<&'a ApiFolder> {
    let selected: HashSet<&str> = roots
        .iter()
        .filter(|(workspace_id, _)| workspace_id == &bundle.workspace.id)
        .map(|(_, folder_id)| folder_id.as_str())
        .collect();
    let by_id: HashMap<&str, &ApiFolder> = bundle
        .folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder))
        .collect();

    bundle
        .folders
        .iter()
        .filter(|folder| {
            if !selected.contains(folder.id.as_str()) {
                return false;
            }
            let mut parent = folder.folder_id.as_deref();
            let mut seen = HashSet::new();
            while let Some(parent_id) = parent {
                if selected.contains(parent_id) {
                    return false;
                }
                if !seen.insert(parent_id) {
                    break;
                }
                parent = by_id
                    .get(parent_id)
                    .and_then(|ancestor| ancestor.folder_id.as_deref());
            }
            true
        })
        .collect()
}

/// Only folders + HTTP requests reach the collection; gRPC/WS are handled by
/// their own exporters.
fn workspace_item(b: &Bundle) -> Value {
    let mut folder = json!({ "name": b.workspace.name, "item": build_items(b, None) });
    if let Some(a) = auth_to_postman(&b.workspace.auth) {
        folder["auth"] = a;
    }
    folder
}

fn folder_item(b: &Bundle, folder: &ApiFolder) -> Value {
    let auth = match &folder.auth {
        AuthConfig::Inherit {
            from: InheritSource::Workspace,
        } => effective_inherited_auth(
            b,
            folder.folder_id.as_deref(),
            &InheritSource::Workspace,
            &folder.auth,
        ),
        _ => &folder.auth,
    };
    folder_item_with_auth(b, folder, auth)
}

fn root_folder_item(b: &Bundle, folder: &ApiFolder) -> Value {
    folder_item_with_auth(b, folder, effective_root_auth(b, folder))
}

fn folder_item_with_auth(b: &Bundle, folder: &ApiFolder, auth: &AuthConfig) -> Value {
    let mut item = json!({ "name": folder.name, "item": build_items(b, Some(&folder.id)) });
    if let Some(a) = auth_to_postman(auth) {
        item["auth"] = a;
    }
    item
}

fn effective_root_auth<'a>(b: &'a Bundle, folder: &'a ApiFolder) -> &'a AuthConfig {
    let AuthConfig::Inherit { from } = &folder.auth else {
        return &folder.auth;
    };
    effective_inherited_auth(b, folder.folder_id.as_deref(), from, &folder.auth)
}

fn effective_inherited_auth<'a>(
    b: &'a Bundle,
    parent_id: Option<&str>,
    from: &InheritSource,
    fallback: &'a AuthConfig,
) -> &'a AuthConfig {
    let workspace_auth = b.workspace.auth.is_active().then_some(&b.workspace.auth);
    let by_id: HashMap<&str, &ApiFolder> = b
        .folders
        .iter()
        .map(|candidate| (candidate.id.as_str(), candidate))
        .collect();
    let mut parent = parent_id;
    let mut seen = HashSet::new();
    let mut folder_auth = None;
    while let Some(current_id) = parent {
        if !seen.insert(current_id) {
            break;
        }
        let Some(ancestor) = by_id.get(current_id) else {
            break;
        };
        if ancestor.auth.is_active() {
            folder_auth = Some(&ancestor.auth);
            break;
        }
        parent = ancestor.folder_id.as_deref();
    }

    match from {
        InheritSource::Workspace => workspace_auth.or(folder_auth),
        InheritSource::Folder => folder_auth.or(workspace_auth),
    }
    .unwrap_or(fallback)
}

fn build_items(b: &Bundle, parent: Option<&str>) -> Vec<Value> {
    children(b, parent)
        .into_iter()
        .map(|node| match node {
            Node::Folder(f) => folder_item(b, f),
            Node::Http(r) => http_item(b, r),
        })
        .collect()
}

fn http_item(b: &Bundle, r: &HttpRequest) -> Value {
    let mut req = json!({
        "method": r.method,
        "header": headers(&r.headers),
        "url": build_url(&r.url, &r.parameters),
    });
    if let Some(body) = r.body.as_ref().and_then(body_to_postman) {
        req["body"] = body;
    }
    let auth = match &r.auth {
        AuthConfig::Inherit {
            from: InheritSource::Workspace,
        } => effective_inherited_auth(
            b,
            r.folder_id.as_deref(),
            &InheritSource::Workspace,
            &r.auth,
        ),
        _ => &r.auth,
    };
    if let Some(a) = auth_to_postman(auth) {
        req["auth"] = a;
    }
    json!({ "name": r.name, "request": req })
}

fn headers(params: &[RequestParameter]) -> Value {
    Value::Array(
        params
            .iter()
            .map(|p| json!({ "key": p.name, "value": normalize_templates(&p.value), "disabled": !p.enabled }))
            .collect(),
    )
}

/// Path variables follow Voleeo's `:name` token rule; suffixes such as
/// `:id.json` stay part of the path.
fn build_url(url: &str, params: &[RequestParameter]) -> Value {
    let url = normalize_templates(url);
    let classified: Vec<_> = params
        .iter()
        .map(|p| {
            (
                p,
                contains_path_parameter(url.as_ref(), &p.name),
                normalize_templates(&p.value),
            )
        })
        .collect();

    let query: Vec<Value> = classified
        .iter()
        .filter(|(_, is_path, _)| !is_path)
        .map(|(p, _, value)| json!({ "key": p.name, "value": value, "disabled": !p.enabled }))
        .collect();
    let variable: Vec<Value> = classified
        .iter()
        .filter(|(_, is_path, _)| *is_path)
        .map(|(p, _, value)| json!({ "key": p.name, "value": value }))
        .collect();

    let enabled_q: Vec<String> = classified
        .iter()
        .filter(|(p, is_path, _)| !is_path && p.enabled)
        .map(|(p, _, value)| format!("{}={value}", p.name))
        .collect();
    let raw = if enabled_q.is_empty() {
        url.into_owned()
    } else {
        append_query(url.as_ref(), &enabled_q.join("&"))
    };

    let (protocol, host, port, path) = split_url(&raw);
    let mut u = json!({ "raw": raw });
    if let Some(protocol) = protocol {
        u["protocol"] = json!(protocol);
    }
    if !host.is_empty() {
        u["host"] = json!(host);
    }
    if let Some(port) = port {
        u["port"] = json!(port);
    }
    if !path.is_empty() {
        u["path"] = json!(path);
    }
    if !query.is_empty() {
        u["query"] = Value::Array(query);
    }
    if !variable.is_empty() {
        u["variable"] = Value::Array(variable);
    }
    u
}

fn contains_path_parameter(url: &str, name: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let needle = format!(":{name}");
    path.match_indices(&needle).any(|(index, _)| {
        path[index + needle.len()..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_')
    })
}

fn append_query(url: &str, query: &str) -> String {
    let (base, fragment) = url
        .split_once('#')
        .map_or((url, None), |(base, fragment)| (base, Some(fragment)));
    let separator = if base.contains('?') { '&' } else { '?' };
    match fragment {
        Some(fragment) => format!("{base}{separator}{query}#{fragment}"),
        None => format!("{base}{separator}{query}"),
    }
}

fn split_url(raw: &str) -> (Option<String>, Vec<String>, Option<String>, Vec<String>) {
    let base = raw.split(['?', '#']).next().unwrap_or(raw);
    let (protocol, authority_and_path) = match base.split_once("://") {
        Some((scheme, rest)) => (Some(scheme.to_string()), rest),
        None => (None, base),
    };

    let (authority, path) = authority_and_path
        .split_once('/')
        .map_or((authority_and_path, ""), |(host, path)| (host, path));
    let (authority, port) = split_port(authority);
    let host = authority
        .split('.')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect();
    (protocol, host, port, path_segments(path))
}

fn split_port(authority: &str) -> (&str, Option<String>) {
    let Some((host, port)) = authority.rsplit_once(':') else {
        return (authority, None);
    };
    if port.chars().all(|c| c.is_ascii_digit()) || (port.starts_with("{{") && port.ends_with("}}"))
    {
        (host, Some(port.to_string()))
    } else {
        (authority, None)
    }
}

fn path_segments(path: &str) -> Vec<String> {
    path.trim_start_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn body_to_postman(b: &RequestBody) -> Option<Value> {
    match b.kind {
        BodyKind::None => None,
        BodyKind::Json | BodyKind::Xml | BodyKind::Text | BodyKind::Html => {
            let lang = match b.kind {
                BodyKind::Json => "json",
                BodyKind::Xml => "xml",
                BodyKind::Html => "html",
                _ => "text",
            };
            Some(json!({
                "mode": "raw",
                "raw": normalize_templates(&b.text),
                "options": { "raw": { "language": lang } },
            }))
        }
        BodyKind::FormUrlEncoded => Some(json!({
            "mode": "urlencoded",
            "urlencoded": form_fields(b, false),
        })),
        BodyKind::Multipart => Some(json!({
            "mode": "formdata",
            "formdata": form_fields(b, true),
        })),
        BodyKind::Binary => Some(json!({
            "mode": "file",
            "file": { "src": b.file_path.clone().unwrap_or_default() },
        })),
        BodyKind::Graphql => Some(json!({
            "mode": "graphql",
            "graphql": {
                "query": normalize_templates(&b.text),
                "variables": normalize_templates(b.graphql_variables.as_deref().unwrap_or_default()),
            },
        })),
    }
}

fn form_fields(b: &RequestBody, multipart: bool) -> Value {
    let fields = b.fields.as_deref().unwrap_or(&[]);
    Value::Array(
        fields
            .iter()
            .map(|f| {
                if multipart && f.is_file {
                    json!({ "key": f.name, "src": normalize_templates(&f.value), "type": "file", "disabled": !f.enabled })
                } else {
                    json!({ "key": f.name, "value": normalize_templates(&f.value), "type": "text", "disabled": !f.enabled })
                }
            })
            .collect(),
    )
}

/// Flat collection variables = union of every exported env var. Last writer wins
/// on a key clash (the user accepted that when choosing a combined collection).
/// `BTreeMap` keeps output deterministic.
fn collection_variables(bundles: &[Bundle]) -> Value {
    let mut by_key: BTreeMap<String, (std::borrow::Cow<'_, str>, bool, bool)> = BTreeMap::new();
    for b in bundles {
        for env in &b.environments {
            for v in &env.variables {
                by_key.insert(
                    v.key.clone(),
                    (normalize_templates(&v.value), v.encrypted, v.enabled),
                );
            }
        }
    }
    Value::Array(
        by_key
            .into_iter()
            .map(|(key, (value, secret, enabled))| {
                json!({
                    "key": key,
                    "value": value,
                    "type": if secret { "secret" } else { "string" },
                    "disabled": !enabled,
                })
            })
            .collect(),
    )
}

/// One Postman environment file per Voleeo environment (so they land under
/// Postman's **Environments**, not just collection variables). Names are
/// workspace-prefixed when several workspaces are combined, to avoid clashes.
pub fn postman_environments(bundles: &[Bundle]) -> Result<Vec<NamedFile>, VoleeoError> {
    let prefix = bundles.len() > 1;
    let mut out = Vec::new();
    for b in bundles {
        for env in &b.environments {
            if env.variables.is_empty() {
                continue;
            }
            let name = if prefix {
                format!("{} - {}", b.workspace.name, env.name)
            } else {
                env.name.clone()
            };
            let values: Vec<Value> = env
                .variables
                .iter()
                .map(|v| {
                    json!({
                        "key": v.key,
                        "value": normalize_templates(&v.value),
                        "type": if v.encrypted { "secret" } else { "default" },
                        "enabled": v.enabled,
                    })
                })
                .collect();
            let doc = json!({
                "name": name,
                "values": values,
                "_postman_variable_scope": "environment",
                "_postman_exported_using": "Voleeo",
            });
            out.push(NamedFile {
                name,
                content: serde_json::to_string_pretty(&doc)
                    .map_err(|e| VoleeoError::Storage(e.to_string()))?,
            });
        }
    }
    Ok(out)
}
