use crate::ir::ImportedCollection;
use crate::ImportError;

pub fn parse_insomnia(_content: &str) -> Result<ImportedCollection, ImportError> {
    Err(ImportError::Unsupported(
        "Insomnia import is coming in a later phase.".into(),
    ))
}
