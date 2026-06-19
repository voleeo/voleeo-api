//! Parse external API collections (OpenAPI, Swagger, Postman, Insomnia) into a
//! shared IR, then convert that IR to `voleeo-core` types. Pure — no Tauri, no
//! storage, no disk. The Tauri command layer drives parse → filter → build_plan
//! → persist.

pub mod convert;
pub mod detect;
mod insomnia;
pub mod ir;
mod openapi;
mod postman;
mod swagger;
mod util;

use std::collections::HashSet;

pub use convert::{build_plan, filter_items, preview_nodes, ConvertedPlan, ImportNode};
pub use detect::{detect_format, ImportFormat};
pub use ir::*;

#[derive(thiserror::Error, Debug)]
pub enum ImportError {
    #[error("unrecognized collection format")]
    UnknownFormat,
    #[error("parse error: {0}")]
    Parse(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
}

/// Parse `content` in the given format into the IR.
pub fn parse(format: ImportFormat, content: &str) -> Result<ImportedCollection, ImportError> {
    match format {
        ImportFormat::OpenApi => openapi::parse_openapi(content),
        ImportFormat::Swagger2 => swagger::parse_swagger2(content),
        ImportFormat::Postman => postman::parse_postman(content),
        ImportFormat::Insomnia => insomnia::parse_insomnia(content),
    }
}

/// Parse + build the preview tree the UI renders for endpoint selection.
pub fn preview(format: ImportFormat, content: &str) -> Result<ImportPreview, ImportError> {
    let col = parse(format, content)?;
    Ok(ImportPreview {
        format,
        format_version: col.version.clone(),
        suggested_name: col.name.clone(),
        tree: preview_nodes(&col.items),
        variable_count: col.variables.len() as u32,
        warnings: col.warnings.clone(),
    })
}

/// Drop everything not in `selected` (positional ids from `preview`). `None`
/// keeps the whole collection.
pub fn select(mut col: ImportedCollection, selected: Option<&[String]>) -> ImportedCollection {
    if let Some(ids) = selected {
        let set: HashSet<String> = ids.iter().cloned().collect();
        col.items = filter_items(&col.items, &set);
    }
    col
}

/// What `import_preview` returns — a tree the UI shows with checkboxes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub format: ImportFormat,
    /// Source spec version (e.g. `3.0.3`) when the format exposes one.
    pub format_version: Option<String>,
    pub suggested_name: String,
    pub tree: Vec<ImportNode>,
    pub variable_count: u32,
    pub warnings: Vec<String>,
}

/// Where a commit lands: a fresh workspace or an existing one (optionally under
/// a parent folder).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ImportDest {
    NewWorkspace {
        name: String,
        encrypted: bool,
    },
    ExistingWorkspace {
        workspace_id: String,
        parent_folder_id: Option<String>,
    },
}

/// Result of a commit — counts + any warnings to surface.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub workspace_id: String,
    pub folders_created: u32,
    pub requests_created: u32,
    pub variables_created: u32,
    pub warnings: Vec<String>,
}
