//! Yaak data-export JSON → IR. The export is `{ yaakSchema, resources: {
//! workspaces, folders, httpRequests, environments, … } }`; we rebuild the tree
//! by `folderId` (null = workspace root) and order siblings by `sortPriority`.
//! Yaak templating is `${[ var ]}` — converted to Voleeo's `{{ var }}` per string
//! field (a global replace is unsafe: the `]}` closer collides with JSON). Auth on
//! the workspace/folder is inherited by descendants. gRPC/WebSocket resources are
//! ignored; non-base environments are skipped with a warning.

use crate::ir::*;
use crate::util::{name_of, parse_value, strip_query};
use crate::ImportError;
use serde_json::Value;

pub fn parse_yaak(content: &str) -> Result<ImportedCollection, ImportError> {
    let doc = parse_value(content)?;
    let Some(schema) = doc.get("yaakSchema") else {
        return Err(ImportError::Parse(
            "missing `yaakSchema` (not a Yaak export)".into(),
        ));
    };
    let resources = doc.get("resources");
    let workspaces = arr(resources, "workspaces");
    let folders = arr(resources, "folders");
    let requests = arr(resources, "httpRequests");
    let environments = arr(resources, "environments");

    let workspace = workspaces.first();
    let root_auth = workspace.map(auth_of).unwrap_or(ImportedAuth::None);
    let has_global = !matches!(root_auth, ImportedAuth::None);

    let (variables, named_envs) = collect_environments(environments);

    Ok(ImportedCollection {
        name: workspace
            .and_then(|w| w.get("name").and_then(Value::as_str))
            .unwrap_or("Imported API")
            .to_string(),
        version: Some(
            schema
                .as_i64()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "4".into()),
        ),
        variables,
        environments: named_envs,
        root_auth,
        items: build_children(folders, requests, None, has_global),
        warnings: Vec::new(),
    })
}

/// Folders + requests whose `folderId` matches `parent` (None = workspace root),
/// ordered by `sortPriority`. `inherit` is true once an ancestor carries auth.
fn build_children(
    folders: &[Value],
    requests: &[Value],
    parent: Option<&str>,
    inherit: bool,
) -> Vec<ImportedItem> {
    enum Node<'a> {
        Folder(&'a Value),
        Request(&'a Value),
    }
    let mut nodes: Vec<(f64, Node)> = Vec::new();
    for f in folders {
        if folder_id(f) == parent {
            nodes.push((sort_key(f), Node::Folder(f)));
        }
    }
    for r in requests {
        if folder_id(r) == parent {
            nodes.push((sort_key(r), Node::Request(r)));
        }
    }
    nodes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    nodes
        .into_iter()
        .map(|(_, n)| match n {
            Node::Folder(f) => {
                let auth = auth_of(f);
                let has_auth = !matches!(auth, ImportedAuth::None);
                ImportedItem::Folder(ImportedFolder {
                    name: name_of(f),
                    description: f
                        .get("description")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string),
                    auth: if has_auth {
                        auth
                    } else if inherit {
                        ImportedAuth::Inherit
                    } else {
                        ImportedAuth::None
                    },
                    headers: headers_of(f),
                    variables: Vec::new(),
                    items: build_children(folders, requests, id_of(f), inherit || has_auth),
                })
            }
            Node::Request(r) => ImportedItem::Request(build_request(r, inherit)),
        })
        .collect()
}

fn build_request(r: &Value, inherit: bool) -> ImportedRequest {
    let url = tv(r, "url");
    let mut method = sv(r, "method").to_uppercase();
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

    if let Some(params) = r.get("urlParameters").and_then(Value::as_array) {
        for p in params {
            let name = p.get("name").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let value = tv(p, "value");
            // A leading `:` marks a path parameter (the url already carries `:name`).
            if let Some(path_name) = name.strip_prefix(':') {
                req.path_params.push(ImportedParam {
                    name: path_name.to_string(),
                    value,
                    enabled: true,
                });
            } else {
                req.query.push(ImportedParam {
                    name: name.to_string(),
                    value,
                    enabled: enabled(p),
                });
            }
        }
    }
    req.headers = headers_of(r);
    req.body = body_to_body(r);
    req.auth = match r.get("authenticationType").and_then(Value::as_str) {
        Some("none") | Some("") => ImportedAuth::None,
        Some(_) => auth_of(r),
        None if inherit => ImportedAuth::Inherit,
        None => ImportedAuth::None,
    };
    req
}

fn body_to_body(r: &Value) -> Option<ImportedBody> {
    let bt = r.get("bodyType").and_then(Value::as_str)?;
    let body = r.get("body");
    let text = || tv(body.unwrap_or(&Value::Null), "text");
    match bt {
        "" => None,
        "application/json" => Some(ImportedBody::Raw {
            hint: RawKind::Json,
            text: text(),
        }),
        "application/x-www-form-urlencoded" => {
            Some(ImportedBody::FormUrlEncoded(form_fields(body)))
        }
        "multipart/form-data" => Some(ImportedBody::Multipart(form_fields(body))),
        "graphql" => Some(ImportedBody::GraphQl {
            query: tv(body.unwrap_or(&Value::Null), "query"),
            variables: body
                .and_then(|b| b.get("variables"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(convert_template),
        }),
        "binary" => Some(ImportedBody::Binary),
        _ => Some(ImportedBody::Raw {
            hint: RawKind::Text,
            text: text(),
        }),
    }
}

fn form_fields(body: Option<&Value>) -> Vec<ImportedField> {
    body.and_then(|b| b.get("form"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let name = f.get("name").and_then(Value::as_str)?;
                    let is_file = f
                        .get("file")
                        .and_then(Value::as_str)
                        .is_some_and(|s| !s.is_empty());
                    Some(ImportedField {
                        name: name.to_string(),
                        value: tv(f, "value"),
                        is_file,
                        enabled: enabled(f),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn auth_of(v: &Value) -> ImportedAuth {
    let a = v.get("authentication");
    let get = |k: &str| convert_template(a.map(|o| sv(o, k)).unwrap_or_default().as_str());
    match v
        .get("authenticationType")
        .and_then(Value::as_str)
        .unwrap_or("none")
    {
        "none" | "" => ImportedAuth::None,
        "basic" => ImportedAuth::Basic {
            username: get("username"),
            password: get("password"),
        },
        "bearer" => ImportedAuth::Bearer {
            token: get("token"),
        },
        "apikey" => {
            let key = get("key");
            ImportedAuth::ApiKey {
                key: if key.is_empty() {
                    "X-API-Key".into()
                } else {
                    key
                },
                value: get("value"),
                in_header: get("location") != "query",
            }
        }
        "oauth2" => ImportedAuth::OAuth2 {
            grant: match get("grantType").as_str() {
                "authorization_code" => OAuth2GrantKind::AuthorizationCode,
                "password" => OAuth2GrantKind::Password,
                "implicit" => OAuth2GrantKind::Implicit,
                _ => OAuth2GrantKind::ClientCredentials,
            },
            auth_url: get("authorizationUrl"),
            token_url: get("accessTokenUrl"),
            client_id: get("clientId"),
            client_secret: get("clientSecret"),
            scope: get("scope"),
        },
        other => ImportedAuth::Unsupported(other.to_string()),
    }
}

/// Split environments into the base set (`parentModel == "workspace"` → Global)
/// and named sub-environments (→ one Voleeo environment each).
fn collect_environments(envs: &[Value]) -> (Vec<ImportedVariable>, Vec<ImportedEnvironment>) {
    let mut base = Vec::new();
    let mut named = Vec::new();
    for e in envs {
        let vars = env_vars(e);
        if e.get("parentModel").and_then(Value::as_str) == Some("workspace") {
            base = vars;
        } else {
            named.push(ImportedEnvironment {
                name: name_of(e),
                variables: vars,
            });
        }
    }
    (base, named)
}

fn env_vars(e: &Value) -> Vec<ImportedVariable> {
    e.get("variables")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let key = v.get("name").and_then(Value::as_str)?;
                    if key.is_empty() {
                        return None;
                    }
                    Some(ImportedVariable {
                        key: key.to_string(),
                        value: tv(v, "value"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn headers_of(v: &Value) -> Vec<ImportedParam> {
    v.get("headers")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|h| {
                    let name = h.get("name").and_then(Value::as_str)?;
                    if name.is_empty() {
                        return None;
                    }
                    Some(ImportedParam {
                        name: name.to_string(),
                        value: tv(h, "value"),
                        enabled: enabled(h),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Convert Yaak `${[ var ]}` tokens to Voleeo `{{ var }}`. Per-field and scoped to
/// the `${[`…`]}` span so a stray `]}` in JSON-like values is never touched.
fn convert_template(input: &str) -> String {
    if !input.contains("${[") {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("${[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        let Some(end) = after.find("]}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        out.push_str("{{ ");
        out.push_str(after[..end].trim());
        out.push_str(" }}");
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn arr<'a>(resources: Option<&'a Value>, key: &str) -> &'a [Value] {
    resources
        .and_then(|r| r.get(key))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn folder_id(v: &Value) -> Option<&str> {
    v.get("folderId").and_then(Value::as_str)
}
fn id_of(v: &Value) -> Option<&str> {
    v.get("id").and_then(Value::as_str)
}
fn sort_key(v: &Value) -> f64 {
    v.get("sortPriority").and_then(Value::as_f64).unwrap_or(0.0)
}
fn enabled(v: &Value) -> bool {
    v.get("enabled").and_then(Value::as_bool) != Some(false)
}
fn sv(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}
fn tv(v: &Value, key: &str) -> String {
    convert_template(&sv(v, key))
}
