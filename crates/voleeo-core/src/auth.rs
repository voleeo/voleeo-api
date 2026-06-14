//! Auth configuration shared across HTTP requests, folders, and the workspace.
//!
//! `AuthConfig` is the single source of truth for every scheme. Static schemes
//! (Bearer/Basic/ApiKey) reduce to a header or query param at resolve time;
//! dynamic schemes (AWS SigV4, …) carry their resolved config to the executor,
//! which signs the final request. See `is_dynamic`.

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

/// `enabled` defaults to true and is omitted from YAML when true, so toggling a
/// scheme off (per scope) writes a single `enabled: false` and absence reads as
/// on.
fn default_true() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

fn is_default_pkce_method(m: &OAuth2PkceMethod) -> bool {
    *m == OAuth2PkceMethod::default()
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthConfig {
    #[default]
    None,
    /// Request-only, resolved at send time. `from` picks the scope: nearest
    /// ancestor folder with an auth (default), or the workspace.
    Inherit {
        #[serde(default)]
        from: InheritSource,
    },
    Bearer {
        token: String,
        #[serde(default)]
        token_encrypted: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    Basic {
        username: String,
        password: String,
        #[serde(default)]
        password_encrypted: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    ApiKey {
        key: String,
        value: String,
        location: ApiKeyLocation,
        #[serde(default)]
        value_encrypted: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    /// AWS Signature Version 4. Signed at send time over the final request, so
    /// the resolved config travels to the executor rather than producing a
    /// header here. `session_token` is set only for temporary STS credentials.
    AwsSigV4 {
        access_key: String,
        secret_key: String,
        #[serde(default)]
        secret_key_encrypted: bool,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        session_token: String,
        #[serde(default)]
        session_token_encrypted: bool,
        region: String,
        service: String,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    /// OAuth 1.0 (RFC 5849), signed into the `Authorization` header at send time.
    /// `token`/`token_secret` empty = two-legged (consumer-only) flow.
    #[serde(rename = "oauth1")]
    OAuth1 {
        consumer_key: String,
        consumer_secret: String,
        #[serde(default)]
        consumer_secret_encrypted: bool,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        token: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        token_secret: String,
        #[serde(default)]
        token_secret_encrypted: bool,
        #[serde(default)]
        signature_method: OAuth1Signature,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        realm: String,
        /// PEM-encoded RSA private key — only used by the `Rsa*` methods.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        private_key: String,
        #[serde(default)]
        private_key_encrypted: bool,
        /// Where the `oauth_*` params go (header vs query).
        #[serde(default)]
        params_location: OAuth1Location,
        // Advanced overrides — empty means "use the default / omit".
        #[serde(default, skip_serializing_if = "String::is_empty")]
        callback: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        verifier: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        timestamp: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        nonce: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        version: String,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    /// OAuth 2.0 (RFC 6749). Resolves to a `Bearer` header from a machine-local
    /// token cache at send time — `client_secret`/`password` are the only at-rest
    /// secrets; the token itself never lives in the synced config.
    #[serde(rename = "oauth2")]
    OAuth2 {
        grant_type: OAuth2Grant,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        auth_url: String,
        token_url: String,
        client_id: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        client_secret: String,
        #[serde(default)]
        client_secret_encrypted: bool,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        scope: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        audience: String,
        #[serde(default)]
        client_auth: OAuth2ClientAuth,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        use_pkce: bool,
        #[serde(default, skip_serializing_if = "is_default_pkce_method")]
        code_challenge_method: OAuth2PkceMethod,
        /// Optional PKCE verifier override — empty means generate a fresh one per
        /// authorization. Advanced/debug use only.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        code_verifier: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        username: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        password: String,
        #[serde(default)]
        password_encrypted: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
    /// HTTP Digest access authentication (RFC 7616). Challenge-response: the
    /// realm/nonce/algorithm/qop come from the server's `401`, so only the
    /// credentials are stored. Applied by the executor's challenge-retry loop.
    #[serde(rename = "digest")]
    Digest {
        username: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        password: String,
        #[serde(default)]
        password_encrypted: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        enabled: bool,
    },
}

impl AuthConfig {
    /// Mutable borrows of every secret field paired with its `*_encrypted` flag.
    /// `transform_auth_secrets` iterates this, so a new scheme only declares its
    /// secrets here — the encryption round-trip then covers it automatically.
    pub fn secret_fields_mut(&mut self) -> Vec<(&mut String, bool)> {
        match self {
            AuthConfig::Bearer {
                token,
                token_encrypted,
                ..
            } => vec![(token, *token_encrypted)],
            AuthConfig::Basic {
                password,
                password_encrypted,
                ..
            } => vec![(password, *password_encrypted)],
            AuthConfig::ApiKey {
                value,
                value_encrypted,
                ..
            } => vec![(value, *value_encrypted)],
            AuthConfig::AwsSigV4 {
                secret_key,
                secret_key_encrypted,
                session_token,
                session_token_encrypted,
                ..
            } => vec![
                (secret_key, *secret_key_encrypted),
                (session_token, *session_token_encrypted),
            ],
            AuthConfig::OAuth1 {
                consumer_secret,
                consumer_secret_encrypted,
                token_secret,
                token_secret_encrypted,
                private_key,
                private_key_encrypted,
                ..
            } => vec![
                (consumer_secret, *consumer_secret_encrypted),
                (token_secret, *token_secret_encrypted),
                (private_key, *private_key_encrypted),
            ],
            AuthConfig::OAuth2 {
                client_secret,
                client_secret_encrypted,
                password,
                password_encrypted,
                ..
            } => vec![
                (client_secret, *client_secret_encrypted),
                (password, *password_encrypted),
            ],
            AuthConfig::Digest {
                password,
                password_encrypted,
                ..
            } => vec![(password, *password_encrypted)],
            AuthConfig::None | AuthConfig::Inherit { .. } => Vec::new(),
        }
    }

    /// Whether a configured scheme is switched on. The UI toggles this per
    /// scope (request/folder/workspace); `None`/`Inherit` have nothing to gate
    /// so they report enabled.
    pub fn is_enabled(&self) -> bool {
        match self {
            AuthConfig::Bearer { enabled, .. }
            | AuthConfig::Basic { enabled, .. }
            | AuthConfig::ApiKey { enabled, .. }
            | AuthConfig::AwsSigV4 { enabled, .. }
            | AuthConfig::OAuth1 { enabled, .. }
            | AuthConfig::OAuth2 { enabled, .. }
            | AuthConfig::Digest { enabled, .. } => *enabled,
            AuthConfig::None | AuthConfig::Inherit { .. } => true,
        }
    }

    /// A concrete scheme that should actually be applied — configured (not
    /// `None`/`Inherit`) and switched on. Resolve layers gate on this.
    pub fn is_active(&self) -> bool {
        !matches!(self, AuthConfig::None | AuthConfig::Inherit { .. }) && self.is_enabled()
    }

    /// Dynamic schemes are applied by the executor, not injected as a static
    /// header at resolve time, so their resolved config rides on
    /// `HttpRequest.auth`. SigV4/OAuth1 sign the outgoing request; Digest answers
    /// the server's `401` challenge on a retry — both need the executor.
    pub fn is_dynamic(&self) -> bool {
        matches!(
            self,
            AuthConfig::AwsSigV4 { .. } | AuthConfig::OAuth1 { .. } | AuthConfig::Digest { .. }
        )
    }

    /// Whether this scheme can apply to `protocol`. HTTP supports every scheme;
    /// WS/gRPC only the static header schemes. The signing schemes are HTTP-only,
    /// and OAuth 2.0's token flow is HTTP-only for now.
    pub fn supports(&self, protocol: Protocol) -> bool {
        match protocol {
            Protocol::Http => true,
            Protocol::Ws | Protocol::Grpc => {
                !self.is_dynamic() && !matches!(self, AuthConfig::OAuth2 { .. })
            }
        }
    }
}

/// `skip_serializing_if` for the `auth` field on folders/workspaces — keeps the
/// YAML lean when no auth is set.
pub fn is_auth_none(a: &AuthConfig) -> bool {
    matches!(a, AuthConfig::None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_yaml() {
        let cases = vec![
            AuthConfig::None,
            AuthConfig::Inherit {
                from: InheritSource::Workspace,
            },
            AuthConfig::Bearer {
                token: "t".into(),
                token_encrypted: true,
                enabled: true,
            },
            AuthConfig::Basic {
                username: "u".into(),
                password: "p".into(),
                password_encrypted: false,
                enabled: false,
            },
            AuthConfig::ApiKey {
                key: "k".into(),
                value: "v".into(),
                location: ApiKeyLocation::Query,
                value_encrypted: true,
                enabled: true,
            },
            AuthConfig::AwsSigV4 {
                access_key: "AKIA".into(),
                secret_key: "secret".into(),
                secret_key_encrypted: true,
                session_token: "tok".into(),
                session_token_encrypted: true,
                region: "us-east-1".into(),
                service: "execute-api".into(),
                enabled: false,
            },
        ];
        for c in cases {
            let json = serde_json::to_string(&c).unwrap();
            let back: AuthConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(c, back, "round-trip mismatch for {json}");
        }
    }

    #[test]
    fn enabled_omitted_from_json_when_true_present_when_false() {
        let on = AuthConfig::Bearer {
            token: "t".into(),
            token_encrypted: false,
            enabled: true,
        };
        assert!(!serde_json::to_string(&on).unwrap().contains("enabled"));
        let off = AuthConfig::Bearer {
            token: "t".into(),
            token_encrypted: false,
            enabled: false,
        };
        assert!(serde_json::to_string(&off)
            .unwrap()
            .contains("\"enabled\":false"));
        // Absent `enabled` reads as on.
        let parsed: AuthConfig = serde_json::from_str(r#"{"kind":"bearer","token":"t"}"#).unwrap();
        assert!(parsed.is_enabled());
    }

    #[test]
    fn secret_fields_cover_each_scheme() {
        let mut bearer = AuthConfig::Bearer {
            token: "t".into(),
            token_encrypted: true,
            enabled: true,
        };
        assert_eq!(bearer.secret_fields_mut().len(), 1);

        let mut sig = AuthConfig::AwsSigV4 {
            access_key: "a".into(),
            secret_key: "s".into(),
            secret_key_encrypted: true,
            session_token: "x".into(),
            session_token_encrypted: false,
            region: "r".into(),
            service: "svc".into(),
            enabled: true,
        };
        let fields = sig.secret_fields_mut();
        assert_eq!(fields.len(), 2, "sigv4 has two secret fields");

        let mut none = AuthConfig::None;
        assert!(none.secret_fields_mut().is_empty());
    }

    #[test]
    fn is_active_gates_on_enabled_and_kind() {
        let on = AuthConfig::Bearer {
            token: "t".into(),
            token_encrypted: false,
            enabled: true,
        };
        assert!(on.is_active());
        let off = AuthConfig::Bearer {
            token: "t".into(),
            token_encrypted: false,
            enabled: false,
        };
        assert!(!off.is_active(), "disabled scheme is not active");
        assert!(off.is_enabled() == false);
        assert!(!AuthConfig::None.is_active());
        // None/Inherit report enabled (nothing to gate) but are never active.
        assert!(AuthConfig::None.is_enabled());
    }

    #[test]
    fn dynamic_and_protocol_support() {
        let sig = AuthConfig::AwsSigV4 {
            access_key: String::new(),
            secret_key: String::new(),
            secret_key_encrypted: false,
            session_token: String::new(),
            session_token_encrypted: false,
            region: String::new(),
            service: String::new(),
            enabled: true,
        };
        assert!(sig.is_dynamic());
        assert!(sig.supports(Protocol::Http));
        assert!(!sig.supports(Protocol::Grpc));
        assert!(!sig.supports(Protocol::Ws));

        let bearer = AuthConfig::Bearer {
            token: String::new(),
            token_encrypted: false,
            enabled: true,
        };
        assert!(!bearer.is_dynamic());
        assert!(bearer.supports(Protocol::Grpc));
    }
}
