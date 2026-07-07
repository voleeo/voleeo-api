//! Auth configuration shared across HTTP requests, folders, and the workspace.
//!
//! `AuthConfig` is the single source of truth for every scheme. Static schemes
//! (Bearer/Basic/ApiKey) reduce to a header or query param at resolve time;
//! dynamic schemes (AWS SigV4, …) carry their resolved config to the executor,
//! which signs the final request. See `is_dynamic`.
//!
//! `config` holds the enum + its impls; `schemes` the small sub-enums that
//! parameterize its variants.

mod config;
mod schemes;

pub use config::{is_auth_none, AuthConfig};
pub use schemes::{
    ApiKeyLocation, InheritSource, OAuth1Location, OAuth1Signature, OAuth2ClientAuth, OAuth2Grant,
    OAuth2PkceMethod, Protocol,
};
