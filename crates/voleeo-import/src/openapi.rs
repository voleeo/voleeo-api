//! OpenAPI 3.0 / 3.1 → IR. Operations become requests grouped by their first
//! tag (OpenAPI tags are flat → one folder level). Servers become a `base_url`
//! variable, path templating `{id}` becomes `:id`, request bodies are turned
//! into concrete bodies (JSON examples synthesized from the schema), and
//! security schemes map onto the IR auth enum. Internal `$ref`s resolve; external
//! refs are skipped with a warning.

use crate::ir::*;
use crate::util::{parse_value, sanitize_var, schema_example, RefResolver};
use crate::ImportError;
use serde_json::Value;
use std::collections::BTreeMap;

const HTTP_METHODS: [&str; 7] = ["get", "post", "put", "patch", "delete", "head", "options"];
const EXAMPLE_DEPTH: u8 = 6;

pub fn parse_openapi(content: &str) -> Result<ImportedCollection, ImportError> {
    let doc = parse_value(content)?;
    if doc.get("openapi").is_none() {
        return Err(ImportError::Parse("missing `openapi` version field".into()));
    }
    let resolver = RefResolver::new(doc.clone());
    let mut col = ImportedCollection {
        name: str_at(&doc, "/info/title")
            .unwrap_or("Imported API")
            .to_string(),
        version: doc
            .get("openapi")
            .and_then(Value::as_str)
            .map(str::to_string),
        ..Default::default()
    };

    let has_base = add_base_url(&doc, &mut col);
    let base_prefix = if has_base { "{{ base_url }}" } else { "" };

    let schemes = doc.pointer("/components/securitySchemes");
    let (root_auth, mut warns) = security_to_auth(schemes, doc.get("security"));
    // Operations without their own `security` inherit the workspace (root) auth —
    // but only when one actually exists; otherwise they have no auth.
    let has_global = !matches!(root_auth, ImportedAuth::None);
    col.root_auth = root_auth;
    col.warnings.append(&mut warns);

    // Collect operations, then nest them into folders by URL path segments.
    let mut requests: Vec<ImportedRequest> = Vec::new();
    if let Some(Value::Object(paths)) = doc.get("paths") {
        for (path, item) in paths {
            let shared = item.get("parameters");
            for method in HTTP_METHODS {
                let Some(op) = item.get(method) else { continue };
                let (req, mut op_warns) = build_operation(
                    &resolver, schemes, base_prefix, path, method, op, shared, has_global,
                );
                col.warnings.append(&mut op_warns);
                requests.push(req);
            }
        }
    }

    col.items = group_by_path(requests);
    Ok(col)
}

/// `servers[0].url` (with `{var}` defaults expanded) → a `base_url` variable.
fn add_base_url(doc: &Value, col: &mut ImportedCollection) -> bool {
    let Some(url) = str_at(doc, "/servers/0/url") else {
        return false;
    };
    let mut resolved = url.to_string();
    if let Some(Value::Object(vars)) = doc.pointer("/servers/0/variables") {
        for (name, spec) in vars {
            if let Some(def) = spec.get("default").and_then(Value::as_str) {
                resolved = resolved.replace(&format!("{{{name}}}"), def);
            }
        }
    }
    let extra = doc
        .pointer("/servers/1")
        .is_some()
        .then(|| "Only the first server was imported as `base_url`.".to_string());
    col.variables.push(ImportedVariable {
        key: "base_url".into(),
        value: resolved,
    });
    if let Some(w) = extra {
        col.warnings.push(w);
    }
    true
}

fn build_operation(
    resolver: &RefResolver,
    schemes: Option<&Value>,
    base_prefix: &str,
    path: &str,
    method: &str,
    op: &Value,
    shared_params: Option<&Value>,
    has_global: bool,
) -> (ImportedRequest, Vec<String>) {
    let mut warns = Vec::new();
    let name = op
        .get("summary")
        .and_then(Value::as_str)
        .or_else(|| op.get("operationId").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("{} {path}", method.to_uppercase()));

    let url = format!("{base_prefix}{}", path_template_to_segments(path));
    let mut req = ImportedRequest {
        name,
        method: method.to_uppercase(),
        url,
        path: path.to_string(),
        ..Default::default()
    };

    for p in merged_params(resolver, shared_params, op.get("parameters")) {
        classify_param(resolver, &p, &mut req, &mut warns);
    }

    req.body = op
        .get("requestBody")
        .map(|rb| resolve_one(resolver, rb))
        .and_then(|rb| request_body_to_body(resolver, &rb));

    // Operation-level security overrides the global default.
    if let Some(sec) = op.get("security") {
        let (auth, mut w) = security_to_auth(schemes, Some(sec));
        req.auth = auth;
        warns.append(&mut w);
    } else if has_global {
        req.auth = ImportedAuth::Inherit;
    } else {
        req.auth = ImportedAuth::None;
    }

    (req, warns)
}

/// Merge path-item-level and operation-level `parameters`, resolving `$ref`s and
/// deduping by `(name, in)` with the operation winning.
fn merged_params(resolver: &RefResolver, shared: Option<&Value>, op: Option<&Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut seen: Vec<(String, String)> = Vec::new();
    for src in [op, shared].into_iter().flatten() {
        let Some(arr) = src.as_array() else { continue };
        for raw in arr {
            let p = resolve_one(resolver, raw);
            let key = (
                p.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                p.get("in")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            );
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            out.push(p);
        }
    }
    out
}

fn classify_param(
    _resolver: &RefResolver,
    p: &Value,
    req: &mut ImportedRequest,
    warns: &mut Vec<String>,
) {
    let name = p
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return;
    }
    let location = p.get("in").and_then(Value::as_str).unwrap_or("query");
    let enabled = p.get("required").and_then(Value::as_bool).unwrap_or(false);
    let param = ImportedParam {
        name: name.clone(),
        value: String::new(),
        enabled,
    };
    match location {
        "path" => req.path_params.push(ImportedParam {
            enabled: true,
            ..param
        }),
        "header" => req.headers.push(param),
        "cookie" => {
            warns.push(format!(
                "Cookie parameter `{name}` imported as a Cookie header."
            ));
            req.headers.push(ImportedParam {
                name: "Cookie".into(),
                value: format!("{name}="),
                enabled,
            });
        }
        _ => req.query.push(param),
    }
}

fn request_body_to_body(resolver: &RefResolver, rb: &Value) -> Option<ImportedBody> {
    let content = rb.get("content")?.as_object()?;
    // Prefer JSON, then form/multipart, else the first media type.
    let pick = |needle: &str| content.keys().find(|k| k.contains(needle)).cloned();
    let media_type = pick("json")
        .or_else(|| pick("x-www-form-urlencoded"))
        .or_else(|| pick("form-data"))
        .or_else(|| content.keys().next().cloned())?;
    let media = content.get(&media_type)?;
    let schema = media.get("schema");

    if media_type.contains("json") {
        let text = media
            .get("example")
            .cloned()
            .or_else(|| schema.map(|s| schema_example(resolver, s, EXAMPLE_DEPTH)))
            .map(|v| serde_json::to_string_pretty(&v).unwrap_or_default())
            .unwrap_or_default();
        return Some(ImportedBody::Raw {
            hint: RawKind::Json,
            text,
        });
    }
    if media_type.contains("xml") {
        return Some(ImportedBody::Raw {
            hint: RawKind::Xml,
            text: String::new(),
        });
    }
    if media_type.contains("form-data") || media_type.contains("x-www-form-urlencoded") {
        let fields = schema_fields(resolver, schema, media_type.contains("form-data"));
        return Some(if media_type.contains("form-data") {
            ImportedBody::Multipart(fields)
        } else {
            ImportedBody::FormUrlEncoded(fields)
        });
    }
    Some(ImportedBody::Binary)
}

/// One field per schema property; `binary`-format props become file fields.
fn schema_fields(
    resolver: &RefResolver,
    schema: Option<&Value>,
    multipart: bool,
) -> Vec<ImportedField> {
    let mut seen = std::collections::HashSet::new();
    let Some(schema) = schema.map(|s| resolver.resolve(s, &mut seen)) else {
        return Vec::new();
    };
    let Some(Value::Object(props)) = schema.get("properties") else {
        return Vec::new();
    };
    props
        .iter()
        .map(|(name, spec)| {
            let is_file = multipart && spec.get("format").and_then(Value::as_str) == Some("binary");
            ImportedField {
                name: name.clone(),
                value: String::new(),
                is_file,
                enabled: true,
            }
        })
        .collect()
}

/// Map a security scheme set onto the IR auth. Uses the first requirement; the
/// scheme definition comes from `components.securitySchemes`.
fn security_to_auth(
    schemes: Option<&Value>,
    security: Option<&Value>,
) -> (ImportedAuth, Vec<String>) {
    let Some(first) = security.and_then(Value::as_array).and_then(|a| a.first()) else {
        return (ImportedAuth::None, Vec::new());
    };
    let Some(name) = first.as_object().and_then(|o| o.keys().next()) else {
        return (ImportedAuth::None, Vec::new());
    };
    let Some(def) = schemes.and_then(|s| s.get(name)) else {
        return (ImportedAuth::None, Vec::new());
    };
    let ty = def.get("type").and_then(Value::as_str).unwrap_or("");
    match ty {
        "http" => {
            let scheme = def.get("scheme").and_then(Value::as_str).unwrap_or("");
            if scheme.eq_ignore_ascii_case("bearer") {
                (
                    ImportedAuth::Bearer {
                        token: String::new(),
                    },
                    Vec::new(),
                )
            } else if scheme.eq_ignore_ascii_case("basic") {
                (
                    ImportedAuth::Basic {
                        username: String::new(),
                        password: String::new(),
                    },
                    Vec::new(),
                )
            } else {
                (
                    ImportedAuth::Unsupported(format!("http {scheme}")),
                    vec![format!(
                        "Auth scheme `{name}` (http {scheme}) is not supported; left as None."
                    )],
                )
            }
        }
        "apiKey" => (
            ImportedAuth::ApiKey {
                key: def
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("X-API-Key")
                    .to_string(),
                value: String::new(),
                in_header: def.get("in").and_then(Value::as_str) != Some("query"),
            },
            Vec::new(),
        ),
        "oauth2" => oauth2_to_auth(name, def),
        other => (
            ImportedAuth::Unsupported(other.to_string()),
            vec![format!(
                "Auth scheme `{name}` ({other}) is not supported; left as None."
            )],
        ),
    }
}

fn oauth2_to_auth(name: &str, def: &Value) -> (ImportedAuth, Vec<String>) {
    let flows = def.get("flows").and_then(Value::as_object);
    let Some(flows) = flows else {
        return (
            ImportedAuth::Unsupported("oauth2".into()),
            vec![format!(
                "OAuth2 scheme `{name}` had no flows; left as None."
            )],
        );
    };
    // Pick the first recognized flow.
    let (grant, flow) = [
        "clientCredentials",
        "authorizationCode",
        "password",
        "implicit",
    ]
    .iter()
    .find_map(|k| flows.get(*k).map(|f| (grant_for(k), f)))
    .unwrap_or((OAuth2GrantKind::ClientCredentials, def));
    let scope = flow
        .get("scopes")
        .and_then(Value::as_object)
        .map(|s| s.keys().cloned().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    (
        ImportedAuth::OAuth2 {
            grant,
            auth_url: flow
                .get("authorizationUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            token_url: flow
                .get("tokenUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            client_id: String::new(),
            client_secret: String::new(),
            scope,
        },
        Vec::new(),
    )
}

fn grant_for(flow: &str) -> OAuth2GrantKind {
    match flow {
        "authorizationCode" => OAuth2GrantKind::AuthorizationCode,
        "implicit" => OAuth2GrantKind::Implicit,
        "password" => OAuth2GrantKind::Password,
        _ => OAuth2GrantKind::ClientCredentials,
    }
}

/// One node of the URL-path trie.
#[derive(Default)]
struct PathNode {
    requests: Vec<ImportedRequest>,
    children: BTreeMap<String, PathNode>,
}

/// Nest requests into folders by URL path segments. A segment becomes a folder
/// when it holds more than one operation or has sub-paths; a lone leaf operation
/// (e.g. `/pet/findByStatus`) collapses into its parent folder.
fn group_by_path(requests: Vec<ImportedRequest>) -> Vec<ImportedItem> {
    let mut root = PathNode::default();
    for req in requests {
        let mut node = &mut root;
        for seg in req.path.split('/').filter(|s| !s.is_empty()) {
            node = node.children.entry(seg.to_string()).or_default();
        }
        node.requests.push(req);
    }
    node_to_items(&mut root)
}

fn node_to_items(node: &mut PathNode) -> Vec<ImportedItem> {
    let mut items: Vec<ImportedItem> =
        node.requests.drain(..).map(ImportedItem::Request).collect();
    for (seg, child) in &mut node.children {
        if child.requests.len() > 1 || !child.children.is_empty() {
            items.push(ImportedItem::Folder(ImportedFolder {
                name: seg.clone(),
                items: node_to_items(child),
                ..Default::default()
            }));
        } else {
            items.extend(child.requests.drain(..).map(ImportedItem::Request));
        }
    }
    items
}

// ── small helpers ────────────────────────────────────────────────────────────

fn str_at<'a>(doc: &'a Value, ptr: &str) -> Option<&'a str> {
    doc.pointer(ptr).and_then(Value::as_str)
}

/// Resolve a single `$ref` (parameters / requestBody references) to an owned value.
fn resolve_one(resolver: &RefResolver, value: &Value) -> Value {
    let mut seen = std::collections::HashSet::new();
    resolver.resolve(value, &mut seen).clone()
}

/// `/pets/{petId}/toys/{toyId}` → `/pets/:petId/toys/:toyId`.
fn path_template_to_segments(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            let mut name = String::new();
            for n in chars.by_ref() {
                if n == '}' {
                    break;
                }
                name.push(n);
            }
            out.push(':');
            out.push_str(&sanitize_var(&name));
        } else {
            out.push(c);
        }
    }
    out
}
