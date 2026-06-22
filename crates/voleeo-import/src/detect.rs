//! Format auto-detection from raw content. Each phase's parser is wired into
//! `crate::parse`; detection recognizes all four up front so the UI's format
//! picker and the command signature stay stable across phases.

use crate::util::parse_value_opt;
use serde_json::Value;

/// The collection formats Voleeo can import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    OpenApi,
    Swagger2,
    Postman,
    Insomnia,
    Bruno,
    Yaak,
}

/// Sniff the format from JSON/YAML content. Returns `None` when nothing matches.
pub fn detect_format(content: &str) -> Option<ImportFormat> {
    let v = parse_value_opt(content)?;

    // Bruno OpenCollection (YAML) and Yaak (JSON) carry unique root keys.
    if v.get("opencollection").is_some() {
        return Some(ImportFormat::Bruno);
    }
    if v.get("yaakSchema").is_some() {
        return Some(ImportFormat::Yaak);
    }
    if v.get("swagger")
        .and_then(Value::as_str)
        .is_some_and(|s| s.starts_with("2."))
    {
        return Some(ImportFormat::Swagger2);
    }
    if v.get("openapi").is_some() {
        return Some(ImportFormat::OpenApi);
    }
    let postman_schema = v
        .pointer("/info/schema")
        .and_then(Value::as_str)
        .is_some_and(|s| s.contains("schema.getpostman.com"));
    if postman_schema || v.pointer("/info/_postman_id").is_some() {
        return Some(ImportFormat::Postman);
    }
    if v.get("__export_format").is_some()
        || v.get("_type").and_then(Value::as_str) == Some("export")
    {
        return Some(ImportFormat::Insomnia);
    }
    None
}
