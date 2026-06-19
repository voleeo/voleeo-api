//! Postman Collection v2 / v2.1 → IR. Lands in phase 3 — recursive `item[]`
//! folders, `body` modes, and per-item auth arrays.

use crate::ir::ImportedCollection;
use crate::ImportError;

pub fn parse_postman(_content: &str) -> Result<ImportedCollection, ImportError> {
    Err(ImportError::Unsupported(
        "Postman import is coming in a later phase.".into(),
    ))
}
