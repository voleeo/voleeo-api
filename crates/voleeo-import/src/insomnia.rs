//! Insomnia v4 export → IR. Resources are a flat array linked by `parentId`; we
//! reconstruct the tree (workspace → request_group* → request) and order siblings
//! by `metaSortKey`. Insomnia templating `{{ _.var }}` maps to Voleeo's
//! `{{ var }}` — done once as a textual normalize before parsing (the `_.`
//! prefix only ever appears inside these tags). `{% … %}` function tags aren't
//! supported and are left as text with a warning. Auth/headers set on a
//! request_group are inherited by descendants (mirrors the app's folder auth).

use crate::ir::*;
use crate::util::{disabled, name_of, parse_value, strip_query};
use crate::ImportError;
use serde_json::Value;
use std::collections::HashSet;

pub fn parse_insomnia(content: &str) -> Result<ImportedCollection, ImportError> {
    // `{{ _.x }}` → `{{ x }}`. Safe on the raw JSON: `_.` only appears in tags.
    let normalized = content.replace("{{ _.", "{{ ").replace("{{_.", "{{");
    let doc = parse_value(&normalized)?;
    let resources = doc
        .get("resources")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ImportError::Parse("missing `resources` array (not an Insomnia export)".into())
        })?;

    let workspace = resources.iter().find(|r| type_of(r) == "workspace");
    let root_id = workspace
        .map(id_of)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            // No workspace resource: the root is whatever parent isn't itself a resource.
            let ids: HashSet<&str> = resources
                .iter()
                .map(id_of)
                .filter(|s| !s.is_empty())
                .collect();
            resources
                .iter()
                .filter(|r| matches!(type_of(r), "request" | "request_group"))
                .map(parent_of)
                .find(|p| !p.is_empty() && !ids.contains(p))
                .unwrap_or("")
        });

    let mut warnings = Vec::new();
    if content.contains("{%") || has_template_filter(&normalized) {
        warnings.push(
            "Some Insomnia template tags ({% … %} or `|` filters) aren't supported and were \
             left as text — adjust them after import."
                .into(),
        );
    }
    // Only the base environment is imported; flag dropped sub-environments.
    if resources
        .iter()
        .filter(|r| type_of(r) == "environment")
        .count()
        > 1
    {
        warnings.push(
            "Only the base environment was imported; Insomnia sub-environments were skipped."
                .into(),
        );
    }

    Ok(ImportedCollection {
        name: workspace
            .and_then(|w| w.get("name").and_then(Value::as_str))
            .unwrap_or("Imported API")
            .to_string(),
        version: Some("4".into()),
        variables: collect_variables(resources, root_id),
        root_auth: ImportedAuth::None,
        items: build_children(resources, root_id, false),
        warnings,
    })
}

/// Children of `parent_id`, ordered by `metaSortKey`. `inherit` is true when an
/// ancestor request_group carries auth, so authless requests resolve to Inherit.
fn build_children(resources: &[Value], parent_id: &str, inherit: bool) -> Vec<ImportedItem> {
    let mut kids: Vec<&Value> = resources
        .iter()
        .filter(|r| parent_of(r) == parent_id && matches!(type_of(r), "request_group" | "request"))
        .collect();
    kids.sort_by(|a, b| {
        sort_key(a)
            .partial_cmp(&sort_key(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut out = Vec::new();
    for r in kids {
        if type_of(r) == "request_group" {
            let group_auth = r
                .get("authentication")
                .map(to_auth)
                .unwrap_or(ImportedAuth::None);
            let has_auth = !matches!(group_auth, ImportedAuth::None);
            out.push(ImportedItem::Folder(ImportedFolder {
                name: name_of(r),
                description: r
                    .get("description")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
                auth: if has_auth {
                    group_auth
                } else if inherit {
                    ImportedAuth::Inherit
                } else {
                    ImportedAuth::None
                },
                headers: headers_of(r),
                variables: env_data(r.get("environment")),
                items: build_children(resources, id_of(r), inherit || has_auth),
            }));
        } else {
            out.push(ImportedItem::Request(build_request(r, inherit)));
        }
    }
    out
}

fn build_request(r: &Value, inherit: bool) -> ImportedRequest {
    let url = s(r, "url");
    let mut method = s(r, "method").to_uppercase();
    if method.is_empty() {
        method = "GET".into();
    }
    let mut req = ImportedRequest {
        name: name_of(r),
        method,
        url: strip_query(&url).to_string(),
        path: url.clone(),
        ..Default::default()
    };
    req.query = query_of(r);
    if req.query.is_empty() {
        req.query = query_from_url(&url);
    }
    req.headers = headers_of(r);
    req.body = parse_body(r.get("body"));
    // Empty `authentication: {}` means inherit; an explicit type (incl. "none")
    // is taken literally.
    req.auth = match r.get("authentication") {
        Some(a) if a.as_object().is_some_and(|o| !o.is_empty()) => to_auth(a),
        _ if inherit => ImportedAuth::Inherit,
        _ => ImportedAuth::None,
    };
    req
}

fn parse_body(body: Option<&Value>) -> Option<ImportedBody> {
    let body = body?;
    let mime = body.get("mimeType").and_then(Value::as_str).unwrap_or("");
    let has_file = body
        .get("fileName")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty());

    if mime.contains("graphql") {
        // `text` is a JSON blob: { "query": "...", "variables": {...} }.
        let parsed: Value = serde_json::from_str(&s(body, "text")).unwrap_or(Value::Null);
        return Some(ImportedBody::GraphQl {
            query: parsed
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            variables: parsed.get("variables").filter(|v| !v.is_null()).map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| v.to_string())
            }),
        });
    }
    if mime.contains("x-www-form-urlencoded") {
        return Some(ImportedBody::FormUrlEncoded(params_to_fields(
            body.get("params"),
        )));
    }
    if mime.contains("multipart/form-data") {
        return Some(ImportedBody::Multipart(params_to_fields(
            body.get("params"),
        )));
    }
    if has_file {
        return Some(ImportedBody::Binary);
    }
    let text = s(body, "text");
    if text.is_empty() && mime.is_empty() {
        return None;
    }
    Some(ImportedBody::Raw {
        hint: raw_kind(mime),
        text,
    })
}

fn to_auth(a: &Value) -> ImportedAuth {
    if a.get("disabled").and_then(Value::as_bool) == Some(true) {
        return ImportedAuth::None;
    }
    match a.get("type").and_then(Value::as_str).unwrap_or("none") {
        "none" | "" => ImportedAuth::None,
        "bearer" => ImportedAuth::Bearer {
            token: s(a, "token"),
        },
        "basic" => ImportedAuth::Basic {
            username: s(a, "username"),
            password: s(a, "password"),
        },
        "apikey" => {
            let key = s(a, "key");
            ImportedAuth::ApiKey {
                key: if key.is_empty() {
                    "X-API-Key".into()
                } else {
                    key
                },
                value: s(a, "value"),
                in_header: a.get("addTo").and_then(Value::as_str) != Some("queryParams"),
            }
        }
        "oauth2" => ImportedAuth::OAuth2 {
            grant: match a.get("grantType").and_then(Value::as_str).unwrap_or("") {
                "authorization_code" => OAuth2GrantKind::AuthorizationCode,
                "password" => OAuth2GrantKind::Password,
                "implicit" => OAuth2GrantKind::Implicit,
                _ => OAuth2GrantKind::ClientCredentials,
            },
            auth_url: s(a, "authorizationUrl"),
            token_url: s(a, "accessTokenUrl"),
            client_id: s(a, "clientId"),
            client_secret: s(a, "clientSecret"),
            scope: s(a, "scope"),
        },
        other => ImportedAuth::Unsupported(other.to_string()),
    }
}

/// Base-environment `data` map (the environment whose parent is the workspace).
fn collect_variables(resources: &[Value], root_id: &str) -> Vec<ImportedVariable> {
    resources
        .iter()
        .find(|r| type_of(r) == "environment" && parent_of(r) == root_id)
        .map(|e| env_data(e.get("data")))
        .unwrap_or_default()
}

fn env_data(v: Option<&Value>) -> Vec<ImportedVariable> {
    v.and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .map(|(k, val)| ImportedVariable {
                    key: k.clone(),
                    value: match val {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    },
                })
                .collect()
        })
        .unwrap_or_default()
}

fn headers_of(v: &Value) -> Vec<ImportedParam> {
    name_value_list(v.get("headers"))
}

fn query_of(v: &Value) -> Vec<ImportedParam> {
    name_value_list(v.get("parameters"))
}

/// Insomnia's `[{name, value, disabled}]` → params (skips unnamed entries).
fn name_value_list(v: Option<&Value>) -> Vec<ImportedParam> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    let name = p.get("name").and_then(Value::as_str)?;
                    if name.is_empty() {
                        return None;
                    }
                    Some(ImportedParam {
                        name: name.to_string(),
                        value: s(p, "value"),
                        enabled: !disabled(p),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn params_to_fields(v: Option<&Value>) -> Vec<ImportedField> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    let name = p.get("name").and_then(Value::as_str)?;
                    let is_file = p.get("type").and_then(Value::as_str) == Some("file")
                        || p.get("fileName")
                            .and_then(Value::as_str)
                            .is_some_and(|s| !s.is_empty());
                    Some(ImportedField {
                        name: name.to_string(),
                        value: s(p, "value"),
                        is_file,
                        enabled: !disabled(p),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn query_from_url(url: &str) -> Vec<ImportedParam> {
    url.split_once('?')
        .map(|(_, qs)| {
            qs.split('&')
                .filter(|s| !s.is_empty())
                .filter_map(|pair| {
                    let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                    if k.is_empty() {
                        return None;
                    }
                    Some(ImportedParam {
                        name: k.to_string(),
                        value: v.to_string(),
                        enabled: true,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn raw_kind(mime: &str) -> RawKind {
    if mime.contains("json") {
        RawKind::Json
    } else if mime.contains("xml") {
        RawKind::Xml
    } else if mime.contains("html") {
        RawKind::Html
    } else {
        RawKind::Text
    }
}

/// True if any `{{ … }}` span carries a Nunjucks `|` filter (which we can't run).
/// Scans the spans precisely so `|` in plain JSON values doesn't false-positive.
fn has_template_filter(content: &str) -> bool {
    let mut rest = content;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        if after[..end].contains('|') {
            return true;
        }
        rest = &after[end + 2..];
    }
    false
}

fn type_of(v: &Value) -> &str {
    v.get("_type").and_then(Value::as_str).unwrap_or("")
}
fn id_of(v: &Value) -> &str {
    v.get("_id").and_then(Value::as_str).unwrap_or("")
}
fn parent_of(v: &Value) -> &str {
    v.get("parentId").and_then(Value::as_str).unwrap_or("")
}
fn sort_key(v: &Value) -> f64 {
    v.get("metaSortKey").and_then(Value::as_f64).unwrap_or(0.0)
}
fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}
