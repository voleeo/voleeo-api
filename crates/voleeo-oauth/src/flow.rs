//! OAuth 2.0 token requests (RFC 6749). Builds the authorization URL and POSTs
//! the token endpoint per grant type; parses the token / error response.

use serde::Deserialize;
use voleeo_auth::encode::uri_encode;
use voleeo_core::{AuthConfig, OAuth2ClientAuth, OAuth2Grant, OAuth2PkceMethod, VoleeoError};

/// Resolved OAuth 2.0 config (templates expanded, secrets plaintext) extracted
/// from an `AuthConfig::OAuth2`.
pub struct OAuth2Config {
    pub grant: OAuth2Grant,
    pub auth_url: String,
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scope: String,
    pub audience: String,
    pub client_auth: OAuth2ClientAuth,
    pub use_pkce: bool,
    pub code_challenge_method: OAuth2PkceMethod,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub state: String,
    pub username: String,
    pub password: String,
}

impl OAuth2Config {
    pub fn from_auth(auth: &AuthConfig) -> Option<Self> {
        match auth {
            AuthConfig::OAuth2 {
                grant_type,
                auth_url,
                token_url,
                client_id,
                client_secret,
                scope,
                audience,
                client_auth,
                use_pkce,
                code_challenge_method,
                code_verifier,
                redirect_uri,
                state,
                username,
                password,
                ..
            } => Some(Self {
                grant: *grant_type,
                auth_url: auth_url.clone(),
                token_url: token_url.clone(),
                client_id: client_id.clone(),
                client_secret: client_secret.clone(),
                scope: scope.clone(),
                audience: audience.clone(),
                client_auth: *client_auth,
                use_pkce: *use_pkce,
                code_challenge_method: *code_challenge_method,
                code_verifier: code_verifier.clone(),
                redirect_uri: redirect_uri.clone(),
                state: state.clone(),
                username: username.clone(),
                password: password.clone(),
            }),
            _ => None,
        }
    }

    fn grant_str(&self) -> &'static str {
        match self.grant {
            OAuth2Grant::ClientCredentials => "client_credentials",
            OAuth2Grant::AuthorizationCode => "authorization_code",
            OAuth2Grant::Password => "password",
            OAuth2Grant::Implicit => "implicit",
        }
    }

    /// Stable cache key — one token per token_url/client/user/scope/audience.
    /// `username` is included so password-grant tokens for different users don't
    /// collide (it's empty, hence a constant, for the other grants).
    pub fn cache_key(&self) -> String {
        voleeo_auth::oauth2::config_hash(&[
            &self.token_url,
            &self.client_id,
            &self.username,
            self.grant_str(),
            &self.scope,
            &self.audience,
        ])
    }
}

/// Token fields we keep. `expires_at` is unix seconds (0 = no expiry).
pub struct TokenResult {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_at: i64,
}

impl TokenResult {
    /// RFC 6749 §6: a refresh response MAY omit a new refresh token, and then the
    /// client keeps the old one. Without this we'd persist an empty refresh token
    /// and lose the ability to refresh again — forcing a full interactive re-auth.
    fn carry_refresh(mut self, prior: &str) -> Self {
        if self.refresh_token.is_empty() {
            self.refresh_token = prior.to_string();
        }
        self
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    token_type: String,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
    error_description: Option<String>,
}

fn http_err(e: reqwest::Error) -> VoleeoError {
    VoleeoError::Http(e.to_string())
}

/// Authorization-code redirect URL: `auth_url` + the standard query params.
pub fn build_auth_url(
    config: &OAuth2Config,
    redirect_uri: &str,
    state: &str,
    code_challenge: Option<&str>,
) -> String {
    let response_type = if config.grant == OAuth2Grant::Implicit {
        "token"
    } else {
        "code"
    };
    let mut q = vec![
        format!("response_type={response_type}"),
        format!("client_id={}", uri_encode(&config.client_id)),
        format!("redirect_uri={}", uri_encode(redirect_uri)),
        format!("state={}", uri_encode(state)),
    ];
    if !config.scope.is_empty() {
        q.push(format!("scope={}", uri_encode(&config.scope)));
    }
    if !config.audience.is_empty() {
        q.push(format!("audience={}", uri_encode(&config.audience)));
    }
    if let Some(challenge) = code_challenge {
        let method = match config.code_challenge_method {
            OAuth2PkceMethod::S256 => "S256",
            OAuth2PkceMethod::Plain => "plain",
        };
        q.push(format!("code_challenge={}", uri_encode(challenge)));
        q.push(format!("code_challenge_method={method}"));
    }
    let sep = if config.auth_url.contains('?') {
        '&'
    } else {
        '?'
    };
    format!("{}{sep}{}", config.auth_url, q.join("&"))
}

/// Scope/audience belong only on the direct-fetch token requests (RFC 6749
/// §4.4.2/§4.3.2). The authorization-code exchange (§4.1.3) binds scope at
/// `/authorize`, and refresh (§6) omitting scope means "the originally granted
/// scope" — safer than echoing a possibly-divergent configured value.
fn grant_sends_scope(grant: OAuth2Grant) -> bool {
    matches!(
        grant,
        OAuth2Grant::ClientCredentials | OAuth2Grant::Password
    )
}

/// A confidential client authenticates with HTTP Basic (RFC 6749 §2.3.1). A
/// public client — no secret, e.g. authorization_code + PKCE — must NOT: an
/// empty-password Basic header reads as a misconfigured confidential client, so
/// `client_id` goes in the request body instead (§4.1.3).
fn uses_basic_auth(client_auth: OAuth2ClientAuth, client_secret: &str) -> bool {
    client_auth == OAuth2ClientAuth::BasicHeader && !client_secret.is_empty()
}

async fn post_token(
    client: &reqwest::Client,
    config: &OAuth2Config,
    mut form: Vec<(&str, String)>,
) -> Result<TokenResult, VoleeoError> {
    if grant_sends_scope(config.grant) {
        if !config.scope.is_empty() {
            form.push(("scope", config.scope.clone()));
        }
        if !config.audience.is_empty() {
            form.push(("audience", config.audience.clone()));
        }
    }
    let mut req = client.post(&config.token_url);
    if uses_basic_auth(config.client_auth, &config.client_secret) {
        req = req.basic_auth(&config.client_id, Some(&config.client_secret));
    } else {
        form.push(("client_id", config.client_id.clone()));
        if !config.client_secret.is_empty() {
            form.push(("client_secret", config.client_secret.clone()));
        }
    }

    let resp = req.form(&form).send().await.map_err(http_err)?;
    let status = resp.status();
    let body = resp.text().await.map_err(http_err)?;
    if !status.is_success() {
        if let Ok(e) = serde_json::from_str::<ErrorResponse>(&body) {
            let detail = e
                .error_description
                .map(|d| format!(" — {d}"))
                .unwrap_or_default();
            return Err(VoleeoError::Http(format!(
                "OAuth2 token error: {}{detail}",
                e.error
            )));
        }
        return Err(VoleeoError::Http(format!(
            "OAuth2 token request failed ({status})"
        )));
    }

    let tr: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| VoleeoError::Http(format!("Invalid token response: {e}")))?;
    let expires_at = tr
        .expires_in
        .map(|s| chrono::Utc::now().timestamp() + s - 30) // 30s skew
        .unwrap_or(0);
    Ok(TokenResult {
        access_token: tr.access_token,
        refresh_token: tr.refresh_token.unwrap_or_default(),
        token_type: if tr.token_type.is_empty() {
            "Bearer".into()
        } else {
            tr.token_type
        },
        scope: tr.scope.unwrap_or_else(|| config.scope.clone()),
        expires_at,
    })
}

pub async fn fetch_client_credentials(
    client: &reqwest::Client,
    config: &OAuth2Config,
) -> Result<TokenResult, VoleeoError> {
    post_token(
        client,
        config,
        vec![("grant_type", "client_credentials".into())],
    )
    .await
}

pub async fn fetch_password(
    client: &reqwest::Client,
    config: &OAuth2Config,
) -> Result<TokenResult, VoleeoError> {
    post_token(
        client,
        config,
        vec![
            ("grant_type", "password".into()),
            ("username", config.username.clone()),
            ("password", config.password.clone()),
        ],
    )
    .await
}

pub async fn exchange_code(
    client: &reqwest::Client,
    config: &OAuth2Config,
    code: String,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResult, VoleeoError> {
    let mut params = vec![
        ("grant_type", "authorization_code".into()),
        ("code", code),
        ("redirect_uri", redirect_uri.to_string()),
    ];
    if !verifier.is_empty() {
        params.push(("code_verifier", verifier.to_string()));
    }
    post_token(client, config, params).await
}

pub async fn refresh(
    client: &reqwest::Client,
    config: &OAuth2Config,
    refresh_token: &str,
) -> Result<TokenResult, VoleeoError> {
    let result = post_token(
        client,
        config,
        vec![
            ("grant_type", "refresh_token".into()),
            ("refresh_token", refresh_token.to_string()),
        ],
    )
    .await?;
    Ok(result.carry_refresh(refresh_token))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(refresh: &str) -> TokenResult {
        TokenResult {
            access_token: "at".into(),
            refresh_token: refresh.into(),
            token_type: "Bearer".into(),
            scope: String::new(),
            expires_at: 0,
        }
    }

    #[test]
    fn refresh_token_preserved_when_response_omits_it() {
        // Server rotated the token → use the new one.
        assert_eq!(token("new").carry_refresh("old").refresh_token, "new");
        // Server omitted it → keep the prior token rather than clobbering it.
        assert_eq!(token("").carry_refresh("old").refresh_token, "old");
    }

    #[test]
    fn only_direct_fetch_grants_send_scope() {
        assert!(grant_sends_scope(OAuth2Grant::ClientCredentials));
        assert!(grant_sends_scope(OAuth2Grant::Password));
        // Auth-code binds scope at /authorize (§4.1.3); refresh omits it (§6).
        assert!(!grant_sends_scope(OAuth2Grant::AuthorizationCode));
        assert!(!grant_sends_scope(OAuth2Grant::Implicit));
    }

    #[test]
    fn public_client_skips_basic_auth() {
        use OAuth2ClientAuth::*;
        // Confidential client: Basic header selected and a secret present.
        assert!(uses_basic_auth(BasicHeader, "secret"));
        // Public PKCE client (no secret) sends client_id in the body, never an
        // empty-password Basic header.
        assert!(!uses_basic_auth(BasicHeader, ""));
        // Request-body mode never uses Basic, secret or not.
        assert!(!uses_basic_auth(RequestBody, "secret"));
        assert!(!uses_basic_auth(RequestBody, ""));
    }
}
