//! Shared parsing helpers: JSON/YAML loading, `$ref` resolution, variable-name
//! sanitization, and JSON-Schema example synthesis. Used by the OpenAPI and
//! Swagger parsers (both speak JSON Schema + internal `$ref`s).

use crate::ir::*;
use crate::ImportError;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};

/// Parse `content` as JSON, falling back to YAML (specs ship as either).
pub fn parse_value(content: &str) -> Result<Value, ImportError> {
    if let Ok(v) = serde_json::from_str::<Value>(content) {
        return Ok(v);
    }
    serde_yaml::from_str::<Value>(content).map_err(|e| ImportError::Parse(e.to_string()))
}

/// Best-effort parse for format detection — returns `None` instead of erroring.
pub fn parse_value_opt(content: &str) -> Option<Value> {
    parse_value(content).ok()
}

/// Sanitize an arbitrary name into a POSIX identifier (`[A-Za-z_][A-Za-z0-9_]*`)
/// usable as a `{{ var }}` key. Non-identifier chars become `_`; a leading digit
/// gets an `_` prefix. Empty input yields `var`.
pub fn sanitize_var(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        return "var".to_string();
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// Resolves internal JSON-pointer `$ref`s (`#/components/...`, `#/definitions/...`)
/// against the whole document. External/remote refs are unsupported — the walk
/// stops and the caller emits a warning.
pub struct RefResolver {
    root: Value,
}

impl RefResolver {
    pub fn new(root: Value) -> Self {
        Self { root }
    }

    /// Follow a chain of internal `$ref`s starting at `value`, returning the first
    /// concrete node. A `seen` set breaks cycles; an unresolvable ref stops the walk.
    pub fn resolve<'a>(&'a self, value: &'a Value, seen: &mut HashSet<String>) -> &'a Value {
        let mut cur = value;
        while let Some(ptr) = cur.get("$ref").and_then(Value::as_str) {
            if !seen.insert(ptr.to_string()) {
                break;
            }
            match self.lookup(ptr) {
                Some(next) => cur = next,
                None => break,
            }
        }
        cur
    }

    fn lookup(&self, ptr: &str) -> Option<&Value> {
        let path = ptr.strip_prefix("#/")?;
        let mut cur = &self.root;
        for raw in path.split('/') {
            let key = raw.replace("~1", "/").replace("~0", "~");
            cur = cur.get(&key)?;
        }
        Some(cur)
    }
}

/// Synthesize a JSON example from an OpenAPI/Swagger schema. Prefers an explicit
/// `example`/`default`/`enum[0]`; otherwise emits a typed placeholder. Bounded
/// `depth` plus a `$ref` visited-set keep recursive schemas finite.
pub fn schema_example(resolver: &RefResolver, schema: &Value, depth: u8) -> Value {
    let mut seen = HashSet::new();
    example_inner(resolver, schema, depth, &mut seen)
}

fn example_inner(
    resolver: &RefResolver,
    schema: &Value,
    depth: u8,
    seen: &mut HashSet<String>,
) -> Value {
    let schema = resolver.resolve(schema, seen);
    if let Some(ex) = schema.get("example") {
        return ex.clone();
    }
    if let Some(d) = schema.get("default") {
        return d.clone();
    }
    if let Some(Value::Array(vals)) = schema.get("enum") {
        if let Some(first) = vals.first() {
            return first.clone();
        }
    }
    if let Some(Value::Array(all)) = schema.get("allOf") {
        let mut merged = Map::new();
        for sub in all {
            if let Value::Object(m) = example_inner(resolver, sub, depth, seen) {
                merged.extend(m);
            }
        }
        return Value::Object(merged);
    }
    for key in ["oneOf", "anyOf"] {
        if let Some(Value::Array(variants)) = schema.get(key) {
            if let Some(first) = variants.first() {
                return example_inner(resolver, first, depth, seen);
            }
        }
    }

    let ty = schema.get("type").and_then(|t| match t {
        Value::String(s) => Some(s.as_str()),
        Value::Array(a) => a.first().and_then(Value::as_str), // 3.1 type arrays
        _ => None,
    });
    let has_props = schema.get("properties").is_some();

    match ty {
        Some("object") => build_object(resolver, schema, depth, seen),
        Some("array") => build_array(resolver, schema, depth, seen),
        Some("integer") => Value::from(0),
        Some("number") => Value::from(0.0),
        Some("boolean") => Value::Bool(false),
        Some("string") => Value::String(placeholder_string(schema)),
        None if has_props => build_object(resolver, schema, depth, seen),
        _ => Value::Null,
    }
}

fn build_object(
    resolver: &RefResolver,
    schema: &Value,
    depth: u8,
    seen: &mut HashSet<String>,
) -> Value {
    if depth == 0 {
        return Value::Object(Map::new());
    }
    let mut obj = Map::new();
    if let Some(Value::Object(props)) = schema.get("properties") {
        for (k, v) in props {
            obj.insert(k.clone(), example_inner(resolver, v, depth - 1, seen));
        }
    }
    Value::Object(obj)
}

fn build_array(
    resolver: &RefResolver,
    schema: &Value,
    depth: u8,
    seen: &mut HashSet<String>,
) -> Value {
    if depth == 0 {
        return Value::Array(vec![]);
    }
    let item = schema
        .get("items")
        .map(|it| example_inner(resolver, it, depth - 1, seen))
        .unwrap_or(Value::Null);
    Value::Array(vec![item])
}

fn placeholder_string(schema: &Value) -> String {
    match schema.get("format").and_then(Value::as_str) {
        Some("date-time") => "1970-01-01T00:00:00Z".into(),
        Some("date") => "1970-01-01".into(),
        Some("uuid") => "00000000-0000-0000-0000-000000000000".into(),
        Some("email") => "user@example.com".into(),
        Some("uri") | Some("url") => "https://example.com".into(),
        _ => String::new(),
    }
}

// ── shared OpenAPI/Swagger plumbing ──────────────────────────────────────────
// Both formats share JSON-Schema params, `{id}` path templating, and the
// path-trie folder grouping; one copy lives here so each parser stays format-
// specific (base URL, security, body media types).

pub const HTTP_METHODS: [&str; 7] = ["get", "post", "put", "patch", "delete", "head", "options"];
/// Bounded recursion depth for schema example synthesis (cycle-safe via the
/// `$ref` visited-set in `schema_example`).
pub const EXAMPLE_DEPTH: u8 = 6;

pub fn str_at<'a>(doc: &'a Value, ptr: &str) -> Option<&'a str> {
    doc.pointer(ptr).and_then(Value::as_str)
}

/// Resolve a single `$ref` (parameters / bodies) to an owned value.
pub fn resolve_one(resolver: &RefResolver, value: &Value) -> Value {
    let mut seen = HashSet::new();
    resolver.resolve(value, &mut seen).clone()
}

/// `/pets/{petId}/toys/{toyId}` → `/pets/:petId/toys/:toyId`.
pub fn path_template_to_segments(path: &str) -> String {
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

/// Merge path-item-level and operation-level `parameters`, resolving `$ref`s and
/// deduping by `(name, in)` with the operation winning.
pub fn merged_params(
    resolver: &RefResolver,
    shared: Option<&Value>,
    op: Option<&Value>,
) -> Vec<Value> {
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

/// Route a query/header/path/cookie parameter onto the request. `body`/`formData`
/// (Swagger) are handled by the caller before this.
pub fn classify_param(p: &Value, req: &mut ImportedRequest, warns: &mut Vec<String>) {
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

/// One node of the URL-path trie.
#[derive(Default)]
struct PathNode {
    requests: Vec<ImportedRequest>,
    children: BTreeMap<String, PathNode>,
}

/// Nest requests into folders by URL path segments. A segment becomes a folder
/// when it holds more than one operation or has sub-paths; a lone leaf operation
/// (e.g. `/pet/findByStatus`) collapses into its parent folder.
pub fn group_by_path(requests: Vec<ImportedRequest>) -> Vec<ImportedItem> {
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
    let mut items: Vec<ImportedItem> = node.requests.drain(..).map(ImportedItem::Request).collect();
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
