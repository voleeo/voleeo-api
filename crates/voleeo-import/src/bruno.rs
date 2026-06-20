//! Bruno OpenCollection (single-file YAML) → IR. `items[]` nests explicitly
//! (`info.type` is `folder` or `http`), ordered by `info.seq`. Bruno templating
//! is `{{var}}` — identical to Voleeo, so values pass through verbatim. Auth on a
//! folder/collection `request` block is inherited by descendants (the literal
//! string `auth: inherit` requests that inheritance). Collection/folder variables
//! and the first `config.environments` entry become collection variables; scripts
//! aren't importable → one warning.

use crate::ir::*;
use crate::util::{disabled, name_of, parse_value, strip_query};
use crate::ImportError;
use serde_json::Value;

pub fn parse_bruno(content: &str) -> Result<ImportedCollection, ImportError> {
    let doc = parse_value(content)?;
    if doc.get("opencollection").is_none() {
        return Err(ImportError::Parse(
            "missing `opencollection` key (not a Bruno/OpenCollection file)".into(),
        ));
    }

    let mut warnings = Vec::new();
    // Collection-level `request` block holds defaults (auth/variables/scripts).
    let coll_req = doc.get("request");
    let root_auth = match coll_req.and_then(|r| r.get("auth")).map(parse_auth) {
        Some(ImportedAuth::Inherit) | None => ImportedAuth::None,
        Some(a) => a,
    };
    let has_global = !matches!(root_auth, ImportedAuth::None);

    let mut scripts = 0u32;
    count_scripts(&doc, &mut scripts);
    let items = match doc.get("items") {
        Some(Value::Array(arr)) => build_items(arr, has_global, &mut scripts),
        _ => Vec::new(),
    };
    if scripts > 0 {
        let (plural, verb) = if scripts == 1 {
            ("", "was")
        } else {
            ("s", "were")
        };
        warnings.push(format!(
            "{scripts} script{plural} {verb} detected and skipped — Voleeo doesn't run scripts."
        ));
    }

    Ok(ImportedCollection {
        name: doc
            .pointer("/info/name")
            .and_then(Value::as_str)
            .unwrap_or("Imported API")
            .to_string(),
        version: doc
            .get("opencollection")
            .and_then(Value::as_str)
            .map(str::to_string),
        variables: doc
            .pointer("/request/variables")
            .map(to_variables)
            .unwrap_or_default(),
        environments: collect_environments(&doc),
        root_auth,
        items,
        warnings,
    })
}

fn build_items(items: &[Value], inherit: bool, scripts: &mut u32) -> Vec<ImportedItem> {
    let mut sorted: Vec<&Value> = items.iter().collect();
    sorted.sort_by_key(|it| seq_of(it));

    let mut out = Vec::new();
    for it in sorted {
        count_scripts(it, scripts);
        match info_str(it, "type") {
            "folder" => {
                let req = it.get("request");
                let defined = req
                    .and_then(|r| r.get("auth"))
                    .map(parse_auth)
                    .filter(|a| !matches!(a, ImportedAuth::None | ImportedAuth::Inherit));
                let has_auth = defined.is_some();
                out.push(ImportedItem::Folder(ImportedFolder {
                    name: bruno_name(it),
                    description: None,
                    auth: match defined {
                        Some(a) => a,
                        None if inherit => ImportedAuth::Inherit,
                        None => ImportedAuth::None,
                    },
                    headers: req.map(headers_of).unwrap_or_default(),
                    variables: req
                        .and_then(|r| r.get("variables"))
                        .map(to_variables)
                        .unwrap_or_default(),
                    items: match it.get("items") {
                        Some(Value::Array(children)) => {
                            build_items(children, inherit || has_auth, scripts)
                        }
                        _ => Vec::new(),
                    },
                }));
            }
            "http" => out.push(ImportedItem::Request(build_request(it, inherit))),
            // `script` items and anything else are ignored.
            _ => {}
        }
    }
    out
}

fn build_request(it: &Value, inherit: bool) -> ImportedRequest {
    let http = it.get("http");
    let url = http
        .and_then(|h| h.get("url"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut method = http
        .and_then(|h| h.get("method"))
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_uppercase();
    if method.is_empty() {
        method = "GET".into();
    }
    let mut req = ImportedRequest {
        name: bruno_name(it),
        method,
        url: strip_query(&url).to_string(),
        path: url,
        ..Default::default()
    };

    if let Some(h) = http {
        if let Some(params) = h.get("params").and_then(Value::as_array) {
            for p in params {
                let name = p.get("name").and_then(Value::as_str).unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                let param = ImportedParam {
                    name: name.to_string(),
                    value: p
                        .get("value")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    enabled: !disabled(p),
                };
                if p.get("type").and_then(Value::as_str) == Some("path") {
                    req.path_params.push(ImportedParam {
                        enabled: true,
                        ..param
                    });
                } else {
                    req.query.push(param);
                }
            }
        }
        req.headers = headers_of(h);
        req.body = h.get("body").and_then(body_to_body);
        req.auth = match h.get("auth") {
            Some(a) => parse_auth(a),
            None if inherit => ImportedAuth::Inherit,
            None => ImportedAuth::None,
        };
    } else if inherit {
        req.auth = ImportedAuth::Inherit;
    }
    req
}

fn body_to_body(body: &Value) -> Option<ImportedBody> {
    let data = || {
        body.get("data")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match body.get("type").and_then(Value::as_str)? {
        "json" => Some(ImportedBody::Raw {
            hint: RawKind::Json,
            text: data(),
        }),
        "xml" => Some(ImportedBody::Raw {
            hint: RawKind::Xml,
            text: data(),
        }),
        "text" | "sparql" => Some(ImportedBody::Raw {
            hint: RawKind::Text,
            text: data(),
        }),
        "form-urlencoded" => Some(ImportedBody::FormUrlEncoded(form_fields(
            body.get("data"),
            false,
        ))),
        "multipart-form" => Some(ImportedBody::Multipart(form_fields(body.get("data"), true))),
        "file" => Some(ImportedBody::Binary),
        _ => None,
    }
}

fn form_fields(data: Option<&Value>, multipart: bool) -> Vec<ImportedField> {
    data.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let name = f.get("name").and_then(Value::as_str)?;
                    Some(ImportedField {
                        name: name.to_string(),
                        value: f
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        is_file: multipart && f.get("type").and_then(Value::as_str) == Some("file"),
                        enabled: !disabled(f),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `auth: inherit` (string) or an auth object → IR auth.
fn parse_auth(a: &Value) -> ImportedAuth {
    if a.as_str() == Some("inherit") {
        return ImportedAuth::Inherit;
    }
    if !a.is_object() {
        return ImportedAuth::None;
    }
    let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match a.get("type").and_then(Value::as_str).unwrap_or("") {
        "basic" => ImportedAuth::Basic {
            username: s("username"),
            password: s("password"),
        },
        "bearer" => ImportedAuth::Bearer { token: s("token") },
        "apikey" => {
            let key = s("key");
            ImportedAuth::ApiKey {
                key: if key.is_empty() {
                    "X-API-Key".into()
                } else {
                    key
                },
                value: s("value"),
                in_header: a.get("placement").and_then(Value::as_str) != Some("query"),
            }
        }
        "oauth2" => {
            let creds = a.get("credentials");
            let cred = |k: &str| {
                creds
                    .and_then(|c| c.get(k))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            ImportedAuth::OAuth2 {
                grant: match a.get("flow").and_then(Value::as_str).unwrap_or("") {
                    "authorization_code" => OAuth2GrantKind::AuthorizationCode,
                    "password" => OAuth2GrantKind::Password,
                    "implicit" => OAuth2GrantKind::Implicit,
                    _ => OAuth2GrantKind::ClientCredentials,
                },
                auth_url: s("authorizationUrl"),
                token_url: s("accessTokenUrl"),
                client_id: cred("clientId"),
                client_secret: cred("clientSecret"),
                scope: s("scope"),
            }
        }
        "" | "none" => ImportedAuth::None,
        other => ImportedAuth::Unsupported(other.to_string()),
    }
}

/// Collection `request.variables` + the first `config.environments` entry.
/// Each `config.environments` entry → a named Voleeo environment.
fn collect_environments(doc: &Value) -> Vec<ImportedEnvironment> {
    doc.pointer("/config/environments")
        .and_then(Value::as_array)
        .map(|envs| {
            envs.iter()
                .map(|e| ImportedEnvironment {
                    name: e
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Environment")
                        .to_string(),
                    variables: e.get("variables").map(to_variables).unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn to_variables(v: &Value) -> Vec<ImportedVariable> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|var| {
                    let key = var.get("name").and_then(Value::as_str)?;
                    if key.is_empty() {
                        return None;
                    }
                    // Secrets export no value.
                    let value = if var.get("secret").and_then(Value::as_bool) == Some(true) {
                        String::new()
                    } else {
                        scalar(var.get("value"))
                    };
                    Some(ImportedVariable {
                        key: key.to_string(),
                        value,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A Bruno value is a plain string or a typed `{ type, data }` wrapper.
fn scalar(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(_)) => v
            .and_then(|o| o.get("data"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
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
                        value: h
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        enabled: !disabled(h),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn count_scripts(node: &Value, scripts: &mut u32) {
    for ptr in ["/runtime/scripts", "/request/scripts"] {
        if let Some(arr) = node.pointer(ptr).and_then(Value::as_array) {
            *scripts += arr
                .iter()
                .filter(|s| {
                    s.get("code")
                        .and_then(Value::as_str)
                        .is_some_and(|c| !c.trim().is_empty())
                })
                .count() as u32;
        }
    }
}

fn info_str<'a>(it: &'a Value, key: &str) -> &'a str {
    it.pointer(&format!("/info/{key}"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn bruno_name(it: &Value) -> String {
    name_of(it.get("info").unwrap_or(it))
}

fn seq_of(it: &Value) -> i64 {
    it.pointer("/info/seq").and_then(Value::as_i64).unwrap_or(0)
}
