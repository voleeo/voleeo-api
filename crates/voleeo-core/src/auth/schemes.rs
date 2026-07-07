//! The small sub-enums that parameterize `AuthConfig`'s scheme variants.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Wire protocol a request travels over. Some auth schemes only make sense for
/// HTTP (SigV4 signs an HTTP request); the UI and resolve layers consult
/// `AuthConfig::supports` so a folder/workspace auth shared across protocols is
/// skipped gracefully where it can't apply.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    Http,
    Ws,
    Grpc,
}

/// Which scope an `AuthConfig::Inherit` resolves against.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InheritSource {
    /// Nearest ancestor folder with an auth, else the workspace. Default.
    #[default]
    Folder,
    /// The workspace's own auth, skipping folders entirely.
    Workspace,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

/// OAuth 1.0 signature method (RFC 5849 §3.4). `Hmac*` use the consumer/token
/// secrets; `Rsa*` sign with the consumer's RSA private key; `PlainText` skips
/// hashing and is only safe over TLS.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuth1Signature {
    #[default]
    HmacSha1,
    HmacSha256,
    HmacSha512,
    RsaSha1,
    RsaSha256,
    RsaSha512,
    PlainText,
}

/// OAuth 2.0 grant type (RFC 6749). `AuthorizationCode` is interactive (browser
/// + loopback); the others fetch a token directly.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuth2Grant {
    #[default]
    ClientCredentials,
    AuthorizationCode,
    Password,
    Implicit,
}

/// How client credentials reach the token endpoint: HTTP Basic header (default)
/// or in the request body.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuth2ClientAuth {
    #[default]
    BasicHeader,
    RequestBody,
}

/// PKCE code-challenge method: SHA-256 (default, recommended) or plain (the
/// verifier is sent as-is). Authorization-code grant only.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuth2PkceMethod {
    #[default]
    S256,
    Plain,
}

/// Where OAuth 1.0 puts its `oauth_*` params: the `Authorization` header
/// (default) or the URL query string.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuth1Location {
    #[default]
    Header,
    Query,
}
