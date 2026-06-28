//! Core types → Postman Collection v2.1. All selected workspaces fold into ONE
//! collection, each as a top-level folder. Env vars become flat collection
//! variables (last-wins on key clash). Only HTTP requests go in the collection —
//! gRPC/WebSocket are exported to their native formats (.proto / AsyncAPI) as
//! companion files by the command layer.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use voleeo_core::{BodyKind, HttpRequest, RequestBody, RequestParameter, VoleeoError};

use crate::auth::auth_to_postman;
use crate::{children, Bundle, ExportResult, NamedFile, Node};

const SCHEMA_2_1: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub fn to_postman(bundles: &[Bundle]) -> Result<ExportResult, VoleeoError> {
    let name = if bundles.len() == 1 {
        bundles[0].workspace.name.clone()
    } else {
        "Voleeo Export".to_string()
    };

    let items: Vec<Value> = bundles
        .iter()
        .map(|b| {
            let mut folder = json!({ "name": b.workspace.name, "item": build_items(b, None) });
            if let Some(a) = auth_to_postman(&b.workspace.auth) {
                folder["auth"] = a;
            }
            folder
        })
        .collect();

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

/// Only folders + HTTP requests reach the collection; gRPC/WS are handled by
/// their own exporters.
fn build_items(b: &Bundle, parent: Option<&str>) -> Vec<Value> {
    children(b, parent)
        .into_iter()
        .map(|node| match node {
            Node::Folder(f) => {
                let mut o = json!({ "name": f.name, "item": build_items(b, Some(&f.id)) });
                if let Some(a) = auth_to_postman(&f.auth) {
                    o["auth"] = a;
                }
                o
            }
            Node::Http(r) => http_item(r),
        })
        .collect()
}

fn http_item(r: &HttpRequest) -> Value {
    let mut req = json!({
        "method": r.method,
        "header": headers(&r.headers),
        "url": build_url(&r.url, &r.parameters),
    });
    if let Some(body) = r.body.as_ref().and_then(body_to_postman) {
        req["body"] = body;
    }
    if let Some(a) = auth_to_postman(&r.auth) {
        req["auth"] = a;
    }
    json!({ "name": r.name, "request": req })
}

fn headers(params: &[RequestParameter]) -> Value {
    Value::Array(
        params
            .iter()
            .map(|p| json!({ "key": p.name, "value": p.value, "disabled": !p.enabled }))
            .collect(),
    )
}

/// A param is a path variable when its name appears as a `:name` segment in the
/// URL (Voleeo + Postman share that syntax); everything else is a query param.
fn build_url(url: &str, params: &[RequestParameter]) -> Value {
    let is_path = |name: &str| url.contains(&format!(":{name}"));

    let query: Vec<Value> = params
        .iter()
        .filter(|p| !is_path(&p.name))
        .map(|p| json!({ "key": p.name, "value": p.value, "disabled": !p.enabled }))
        .collect();
    let variable: Vec<Value> = params
        .iter()
        .filter(|p| is_path(&p.name))
        .map(|p| json!({ "key": p.name, "value": p.value }))
        .collect();

    let enabled_q: Vec<String> = params
        .iter()
        .filter(|p| !is_path(&p.name) && p.enabled)
        .map(|p| format!("{}={}", p.name, p.value))
        .collect();
    let raw = if enabled_q.is_empty() {
        url.to_string()
    } else {
        let sep = if url.contains('?') { '&' } else { '?' };
        format!("{url}{sep}{}", enabled_q.join("&"))
    };

    let mut u = json!({ "raw": raw });
    if !query.is_empty() {
        u["query"] = Value::Array(query);
    }
    if !variable.is_empty() {
        u["variable"] = Value::Array(variable);
    }
    u
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
                "raw": b.text,
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
                "query": b.text,
                "variables": b.graphql_variables.clone().unwrap_or_default(),
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
                    json!({ "key": f.name, "src": f.value, "type": "file", "disabled": !f.enabled })
                } else {
                    json!({ "key": f.name, "value": f.value, "type": "text", "disabled": !f.enabled })
                }
            })
            .collect(),
    )
}

/// Flat collection variables = union of every exported env var. Last writer wins
/// on a key clash (the user accepted that when choosing a combined collection).
/// `BTreeMap` keeps output deterministic.
fn collection_variables(bundles: &[Bundle]) -> Value {
    let mut by_key: BTreeMap<String, (String, bool, bool)> = BTreeMap::new();
    for b in bundles {
        for env in &b.environments {
            for v in &env.variables {
                by_key.insert(v.key.clone(), (v.value.clone(), v.encrypted, v.enabled));
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
                        "value": v.value,
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
