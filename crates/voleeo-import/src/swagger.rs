//! Swagger 2.0 → IR. Shares the path-trie folder grouping, `{id}` templating, and
//! JSON-Schema params/example synthesis with the OpenAPI parser (`crate::util`).
//! Swagger-specific bits live here: `host`+`basePath`+`schemes` → `base_url`,
//! `in:body`/`in:formData` parameters, `consumes`/`produces`, and the flat
//! `securityDefinitions` oauth2 shape (a single `flow`, not nested `flows`).

use crate::ir::*;
use crate::util::{
    classify_param, group_by_path, merged_params, parse_value, path_template_to_segments,
    schema_example, str_at, RefResolver, EXAMPLE_DEPTH, HTTP_METHODS,
};
use crate::ImportError;
use serde_json::Value;

pub fn parse_swagger2(content: &str) -> Result<ImportedCollection, ImportError> {
    let doc = parse_value(content)?;
    if !doc
        .get("swagger")
        .and_then(Value::as_str)
        .is_some_and(|s| s.starts_with("2."))
    {
        return Err(ImportError::Parse(
            "missing or unsupported `swagger` version (expected 2.x)".into(),
        ));
    }
    let resolver = RefResolver::new(doc.clone());
    let mut col = ImportedCollection {
        name: str_at(&doc, "/info/title")
            .unwrap_or("Imported API")
            .to_string(),
        version: doc
            .get("swagger")
            .and_then(Value::as_str)
            .map(str::to_string),
        ..Default::default()
    };

    let has_base = add_base_url(&doc, &mut col);
    let base_prefix = if has_base { "{{ base_url }}" } else { "" };

    let defs = doc.get("securityDefinitions");
    let (root_auth, mut warns) = security_to_auth(defs, doc.get("security"));
    let has_global = !matches!(root_auth, ImportedAuth::None);
    col.root_auth = root_auth;
    col.warnings.append(&mut warns);

    let global_consumes = doc.get("consumes");

    let mut requests: Vec<ImportedRequest> = Vec::new();
    if let Some(Value::Object(paths)) = doc.get("paths") {
        for (path, item) in paths {
            let shared = item.get("parameters");
            for method in HTTP_METHODS {
                let Some(op) = item.get(method) else { continue };
                let (req, mut w) = build_operation(
                    Ctx {
                        resolver: &resolver,
                        defs,
                        base_prefix,
                        has_global,
                        global_consumes,
                    },
                    path,
                    method,
                    op,
                    shared,
                );
                col.warnings.append(&mut w);
                requests.push(req);
            }
        }
    }

    col.items = group_by_path(requests);
    Ok(col)
}

/// `schemes[0]://host + basePath` → a `base_url` variable.
fn add_base_url(doc: &Value, col: &mut ImportedCollection) -> bool {
    let Some(host) = str_at(doc, "/host") else {
        return false;
    };
    // Trim a trailing slash so `basePath: "/"` + `/pet` doesn't yield `host//pet`.
    let base_path = str_at(doc, "/basePath").unwrap_or("").trim_end_matches('/');
    let scheme = doc
        .pointer("/schemes/0")
        .and_then(Value::as_str)
        .unwrap_or("https");
    col.variables.push(ImportedVariable {
        key: "base_url".into(),
        value: format!("{scheme}://{host}{base_path}"),
    });
    true
}

/// Document-level context shared by every operation (keeps the arg list sane).
struct Ctx<'a> {
    resolver: &'a RefResolver,
    defs: Option<&'a Value>,
    base_prefix: &'a str,
    has_global: bool,
    global_consumes: Option<&'a Value>,
}

fn build_operation(
    ctx: Ctx,
    path: &str,
    method: &str,
    op: &Value,
    shared_params: Option<&Value>,
) -> (ImportedRequest, Vec<String>) {
    let mut warns = Vec::new();
    let name = op
        .get("summary")
        .and_then(Value::as_str)
        .or_else(|| op.get("operationId").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("{} {path}", method.to_uppercase()));

    let url = format!("{}{}", ctx.base_prefix, path_template_to_segments(path));
    let mut req = ImportedRequest {
        name,
        method: method.to_uppercase(),
        url,
        path: path.to_string(),
        ..Default::default()
    };

    let mut form: Vec<ImportedField> = Vec::new();
    let mut has_file = false;
    for p in merged_params(ctx.resolver, shared_params, op.get("parameters")) {
        match p.get("in").and_then(Value::as_str).unwrap_or("query") {
            "body" => req.body = body_param_to_body(ctx.resolver, &p),
            "formData" => {
                let is_file = p.get("type").and_then(Value::as_str) == Some("file");
                has_file |= is_file;
                form.push(ImportedField {
                    name: p
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value: String::new(),
                    is_file,
                    enabled: true,
                });
            }
            _ => classify_param(&p, &mut req, &mut warns),
        }
    }

    if !form.is_empty() && req.body.is_none() {
        let multipart = has_file || consumes_multipart(op.get("consumes").or(ctx.global_consumes));
        req.body = Some(if multipart {
            ImportedBody::Multipart(form)
        } else {
            ImportedBody::FormUrlEncoded(form)
        });
    }

    // Only an operation-level `produces` override earns an Accept header; a
    // document default would noise up every request (and OpenAPI emits none).
    if let Some(accept) = first_str(op.get("produces")) {
        req.headers.push(ImportedParam {
            name: "Accept".into(),
            value: accept,
            enabled: true,
        });
    }

    if let Some(sec) = op.get("security") {
        let (auth, mut w) = security_to_auth(ctx.defs, Some(sec));
        req.auth = auth;
        warns.append(&mut w);
    } else if ctx.has_global {
        req.auth = ImportedAuth::Inherit;
    } else {
        req.auth = ImportedAuth::None;
    }

    (req, warns)
}

/// Swagger body params are JSON — synthesize an example from `schema`.
fn body_param_to_body(resolver: &RefResolver, p: &Value) -> Option<ImportedBody> {
    let text = p
        .get("schema")
        .map(|s| schema_example(resolver, s, EXAMPLE_DEPTH))
        .map(|v| serde_json::to_string_pretty(&v).unwrap_or_default())
        .unwrap_or_default();
    Some(ImportedBody::Raw {
        hint: RawKind::Json,
        text,
    })
}

fn consumes_multipart(consumes: Option<&Value>) -> bool {
    consumes.and_then(Value::as_array).is_some_and(|a| {
        a.iter()
            .filter_map(Value::as_str)
            .any(|c| c.contains("multipart"))
    })
}

fn first_str(arr: Option<&Value>) -> Option<String> {
    arr.and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Map the first `security` requirement onto the IR auth via `securityDefinitions`.
fn security_to_auth(defs: Option<&Value>, security: Option<&Value>) -> (ImportedAuth, Vec<String>) {
    let Some(first) = security.and_then(Value::as_array).and_then(|a| a.first()) else {
        return (ImportedAuth::None, Vec::new());
    };
    let Some(name) = first.as_object().and_then(|o| o.keys().next()) else {
        return (ImportedAuth::None, Vec::new());
    };
    let Some(def) = defs.and_then(|d| d.get(name)) else {
        return (ImportedAuth::None, Vec::new());
    };
    match def.get("type").and_then(Value::as_str).unwrap_or("") {
        "basic" => (
            ImportedAuth::Basic {
                username: String::new(),
                password: String::new(),
            },
            Vec::new(),
        ),
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
        "oauth2" => oauth2_to_auth(def),
        other => (
            ImportedAuth::Unsupported(other.to_string()),
            vec![format!(
                "Auth scheme `{name}` ({other}) is not supported; left as None."
            )],
        ),
    }
}

/// Swagger oauth2 is flat: one `flow` + top-level `authorizationUrl`/`tokenUrl`.
fn oauth2_to_auth(def: &Value) -> (ImportedAuth, Vec<String>) {
    let grant = match def.get("flow").and_then(Value::as_str).unwrap_or("") {
        "implicit" => OAuth2GrantKind::Implicit,
        "password" => OAuth2GrantKind::Password,
        "accessCode" => OAuth2GrantKind::AuthorizationCode,
        _ => OAuth2GrantKind::ClientCredentials, // "application" + fallback
    };
    let scope = def
        .get("scopes")
        .and_then(Value::as_object)
        .map(|s| s.keys().cloned().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    (
        ImportedAuth::OAuth2 {
            grant,
            auth_url: def
                .get("authorizationUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            token_url: def
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
