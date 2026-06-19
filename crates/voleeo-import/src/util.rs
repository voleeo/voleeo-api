//! Shared parsing helpers: JSON/YAML loading, `$ref` resolution, variable-name
//! sanitization, and JSON-Schema example synthesis. Used by the OpenAPI and
//! Swagger parsers (both speak JSON Schema + internal `$ref`s).

use crate::ImportError;
use serde_json::{Map, Value};
use std::collections::HashSet;

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
