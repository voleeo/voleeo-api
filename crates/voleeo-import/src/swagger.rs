//! Swagger 2.0 → IR. Lands in phase 2 — reuses `util::RefResolver` (rooted at
//! `#/definitions`) and the schema example generator.

use crate::ir::ImportedCollection;
use crate::ImportError;

pub fn parse_swagger2(_content: &str) -> Result<ImportedCollection, ImportError> {
    Err(ImportError::Unsupported(
        "Swagger 2.0 import is coming in a later phase.".into(),
    ))
}
