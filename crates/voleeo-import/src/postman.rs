//! Postman Collection v2.0 / v2.1 → IR. One parser for both (they differ only in
//! `info.schema`). `item[]` nests to arbitrary depth (a node with `item` is a
//! folder, one with `request` is a request); `url` may be a string or an object
//! with `query`/`variable` arrays; `body` has five modes. Postman `{{var}}`
//! tokens already match Voleeo's syntax, so variable keys pass through verbatim —
//! never sanitized (that would break the references). Auth is a `{type, <type>:
//! [{key,value}]}` shape. `event[]` scripts aren't importable → counted into one
//! warning.

use crate::ir::*;
use crate::util::{disabled, name_of, parse_value, str_at_or, strip_query};
use crate::ImportError;
use serde_json::Value;

/// Warnings + the running script count, threaded through the recursive walk.
#[derive(Default)]
struct Acc {
    warnings: Vec<String>,
    scripts: u32,
}

pub fn parse_postman(content: &str) -> Result<ImportedCollection, ImportError> {
    let doc = parse_value(content)?;
    if doc.get("item").is_none() {
        return Err(ImportError::Parse(
            "missing `item` array (not a Postman collection)".into(),
        ));
    }
    let version = if str_at_or(&doc, "/info/schema").contains("v2.0") {
        "2.0"
    } else {
        "2.1"
    };

    let root_auth = doc.get("auth").map(to_auth).unwrap_or(ImportedAuth::None);
    let has_global = !matches!(root_auth, ImportedAuth::None);

    let mut acc = Acc::default();
    count_scripts(&doc, &mut acc);
    let items = match doc.get("item") {
        Some(Value::Array(arr)) => build_items(arr, has_global, &mut acc),
        _ => Vec::new(),
    };
    if acc.scripts > 0 {
        let (plural, verb) = if acc.scripts == 1 {
            ("", "was")
        } else {
            ("s", "were")
        };
        acc.warnings.push(format!(
            "{n} pre-request/test script{plural} {verb} detected and skipped — Voleeo doesn't run scripts.",
            n = acc.scripts
        ));
    }

    Ok(ImportedCollection {
        name: doc
            .pointer("/info/name")
            .and_then(Value::as_str)
            .unwrap_or("Imported API")
            .to_string(),
        version: Some(version.to_string()),
        variables: variables(doc.get("variable")),
        root_auth,
        items,
        warnings: acc.warnings,
    })
}

fn build_items(items: &[Value], has_global: bool, acc: &mut Acc) -> Vec<ImportedItem> {
    let mut out = Vec::new();
    for it in items {
        count_scripts(it, acc);
        if let Some(Value::Array(children)) = it.get("item") {
            out.push(ImportedItem::Folder(ImportedFolder {
                name: name_of(it),
                description: it
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                // No explicit folder auth → inherit from the collection.
                auth: it.get("auth").map(to_auth).unwrap_or(ImportedAuth::Inherit),
                headers: Vec::new(),
                variables: variables(it.get("variable")),
                items: build_items(children, has_global, acc),
            }));
        } else if let Some(req) = it.get("request") {
            out.push(ImportedItem::Request(build_request(
                name_of(it),
                req,
                has_global,
            )));
        }
    }
    out
}

fn build_request(name: String, req: &Value, has_global: bool) -> ImportedRequest {
    // v2.0 shorthand: `request` is just a URL string.
    if let Some(raw) = req.as_str() {
        let mut r = blank_request(name, "GET");
        set_url_string(raw, &mut r);
        r.auth = inherited(has_global);
        return r;
    }

    let method = req
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_uppercase();
    let mut r = blank_request(name, &method);

    if let Some(url) = req.get("url") {
        parse_url(url, &mut r);
    }
    if let Some(Value::Array(headers)) = req.get("header") {
        for h in headers {
            let key = h.get("key").and_then(Value::as_str).unwrap_or("");
            if key.is_empty() {
                continue;
            }
            r.headers.push(ImportedParam {
                name: key.to_string(),
                value: h
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                enabled: !disabled(h),
            });
        }
    }
    r.body = req.get("body").and_then(parse_body);
    r.auth = match req.get("auth") {
        Some(a) => to_auth(a),
        None => inherited(has_global),
    };
    r
}

fn parse_url(url: &Value, r: &mut ImportedRequest) {
    if let Some(raw) = url.as_str() {
        set_url_string(raw, r);
        return;
    }
    // `raw` is usually present; fall back to the host/path arrays when it isn't.
    let raw = match url.get("raw").and_then(Value::as_str) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => reconstruct_raw(url),
    };
    r.url = strip_query(&raw).to_string();
    r.path = raw;
    if let Some(Value::Array(q)) = url.get("query") {
        for item in q {
            let key = item.get("key").and_then(Value::as_str).unwrap_or("");
            if key.is_empty() {
                continue;
            }
            r.query.push(ImportedParam {
                name: key.to_string(),
                value: item
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                enabled: !disabled(item),
            });
        }
    }
    if let Some(Value::Array(vars)) = url.get("variable") {
        for v in vars {
            let key = v.get("key").and_then(Value::as_str).unwrap_or("");
            if key.is_empty() {
                continue;
            }
            r.path_params.push(ImportedParam {
                name: key.to_string(),
                value: v
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                enabled: true,
            });
        }
    }
}

/// String URL: store it query-stripped and split any `?a=b&c=d` into params.
fn set_url_string(raw: &str, r: &mut ImportedRequest) {
    r.url = strip_query(raw).to_string();
    r.path = raw.to_string();
    if let Some((_, qs)) = raw.split_once('?') {
        for pair in qs.split('&').filter(|s| !s.is_empty()) {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            if k.is_empty() {
                continue;
            }
            r.query.push(ImportedParam {
                name: k.to_string(),
                value: v.to_string(),
                enabled: true,
            });
        }
    }
}

fn parse_body(body: &Value) -> Option<ImportedBody> {
    match body.get("mode").and_then(Value::as_str)? {
        "raw" => Some(ImportedBody::Raw {
            hint: raw_kind(str_at_or(body, "/options/raw/language")),
            text: body
                .get("raw")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        }),
        "urlencoded" => Some(ImportedBody::FormUrlEncoded(form_fields(
            body.get("urlencoded"),
        ))),
        "formdata" => Some(ImportedBody::Multipart(form_fields(body.get("formdata")))),
        "graphql" => Some(ImportedBody::GraphQl {
            query: str_at_or(body, "/graphql/query").to_string(),
            variables: body
                .pointer("/graphql/variables")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        }),
        "file" => Some(ImportedBody::Binary),
        _ => None,
    }
}

fn form_fields(arr: Option<&Value>) -> Vec<ImportedField> {
    arr.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let name = f.get("key").and_then(Value::as_str)?;
                    Some(ImportedField {
                        name: name.to_string(),
                        value: f
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        is_file: f.get("type").and_then(Value::as_str) == Some("file"),
                        enabled: !disabled(f),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `{type, <type>: [{key,value}]}` → IR auth. `<type>` names the field holding the
/// key/value pairs (Postman's quirky shape).
fn to_auth(auth: &Value) -> ImportedAuth {
    let ty = auth.get("type").and_then(Value::as_str).unwrap_or("noauth");
    let params = auth.get(ty);
    let get = |k: &str| kv_lookup(params, k);
    match ty {
        "noauth" => ImportedAuth::None,
        "bearer" => ImportedAuth::Bearer {
            token: get("token"),
        },
        "basic" => ImportedAuth::Basic {
            username: get("username"),
            password: get("password"),
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
                in_header: get("in") != "query",
            }
        }
        "oauth2" => ImportedAuth::OAuth2 {
            grant: match get("grant_type").as_str() {
                "authorization_code" | "authorization_code_with_pkce" => {
                    OAuth2GrantKind::AuthorizationCode
                }
                "password_credentials" | "password" => OAuth2GrantKind::Password,
                "implicit" => OAuth2GrantKind::Implicit,
                _ => OAuth2GrantKind::ClientCredentials,
            },
            auth_url: get("authUrl"),
            token_url: get("accessTokenUrl"),
            client_id: get("clientId"),
            client_secret: get("clientSecret"),
            scope: get("scope"),
        },
        other => ImportedAuth::Unsupported(other.to_string()),
    }
}

/// First `value` whose `key` matches in a Postman key/value array.
fn kv_lookup(arr: Option<&Value>, key: &str) -> String {
    arr.and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .find(|e| e.get("key").and_then(Value::as_str) == Some(key))
        })
        .and_then(|e| e.get("value").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

fn variables(v: Option<&Value>) -> Vec<ImportedVariable> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|item| {
                    let key = item.get("key").and_then(Value::as_str)?;
                    if key.is_empty() {
                        return None;
                    }
                    Some(ImportedVariable {
                        key: key.to_string(),
                        value: item
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn count_scripts(node: &Value, acc: &mut Acc) {
    if let Some(Value::Array(events)) = node.get("event") {
        for e in events {
            if e.pointer("/script/exec")
                .and_then(Value::as_array)
                .is_some_and(|x| {
                    x.iter()
                        .any(|l| l.as_str().is_some_and(|s| !s.trim().is_empty()))
                })
            {
                acc.scripts += 1;
            }
        }
    }
}

fn blank_request(name: String, method: &str) -> ImportedRequest {
    ImportedRequest {
        name,
        method: method.to_string(),
        ..Default::default()
    }
}

fn inherited(has_global: bool) -> ImportedAuth {
    if has_global {
        ImportedAuth::Inherit
    } else {
        ImportedAuth::None
    }
}

fn raw_kind(lang: &str) -> RawKind {
    match lang {
        "json" => RawKind::Json,
        "xml" => RawKind::Xml,
        "html" => RawKind::Html,
        _ => RawKind::Text,
    }
}

/// Rebuild a URL from the `host`/`path` arrays when `url.raw` is missing.
fn reconstruct_raw(url: &Value) -> String {
    let host = join_arr(url.get("host"), ".");
    let path = join_arr(url.get("path"), "/");
    match (host.is_empty(), path.is_empty()) {
        (true, true) => String::new(),
        (false, true) => host,
        (true, false) => format!("/{path}"),
        (false, false) => format!("{host}/{path}"),
    }
}

fn join_arr(v: Option<&Value>, sep: &str) -> String {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(sep)
        })
        .unwrap_or_default()
}
