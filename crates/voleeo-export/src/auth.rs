//! `AuthConfig` → Postman auth. Covers every core scheme (the import IR can't,
//! which is why export maps core types directly). Secret values arrive already
//! decrypted.

use serde_json::{json, Value};
use voleeo_core::{ApiKeyLocation, AuthConfig, OAuth1Location, OAuth1Signature, OAuth2Grant};

/// Postman auth object, or `None` to omit the `auth` key entirely.
/// `Inherit` omits (so Postman's folder inheritance applies); `None`/disabled emit
/// explicit `noauth` to override an inherited scheme.
pub(crate) fn auth_to_postman(a: &AuthConfig) -> Option<Value> {
    match a {
        AuthConfig::Inherit { .. } => None,
        AuthConfig::None => Some(json!({ "type": "noauth" })),
        _ if !a.is_enabled() => Some(json!({ "type": "noauth" })),
        AuthConfig::Bearer { token, .. } => Some(pm("bearer", &[("token", token)])),
        AuthConfig::Basic {
            username, password, ..
        } => Some(pm(
            "basic",
            &[("username", username), ("password", password)],
        )),
        AuthConfig::ApiKey {
            key,
            value,
            location,
            ..
        } => Some(pm(
            "apikey",
            &[
                ("key", key),
                ("value", value),
                (
                    "in",
                    if *location == ApiKeyLocation::Query {
                        "query"
                    } else {
                        "header"
                    },
                ),
            ],
        )),
        AuthConfig::AwsSigV4 {
            access_key,
            secret_key,
            session_token,
            region,
            service,
            ..
        } => Some(pm(
            "awsv4",
            &[
                ("accessKey", access_key),
                ("secretKey", secret_key),
                ("sessionToken", session_token),
                ("region", region),
                ("service", service),
            ],
        )),
        AuthConfig::OAuth1 {
            consumer_key,
            consumer_secret,
            token,
            token_secret,
            signature_method,
            realm,
            params_location,
            ..
        } => Some(pm(
            "oauth1",
            &[
                ("consumerKey", consumer_key),
                ("consumerSecret", consumer_secret),
                ("token", token),
                ("tokenSecret", token_secret),
                ("signatureMethod", oauth1_sig(signature_method)),
                ("realm", realm),
                (
                    "addParamsToHeader",
                    if *params_location == OAuth1Location::Header {
                        "true"
                    } else {
                        "false"
                    },
                ),
            ],
        )),
        AuthConfig::OAuth2 {
            grant_type,
            auth_url,
            token_url,
            client_id,
            client_secret,
            scope,
            ..
        } => Some(pm(
            "oauth2",
            &[
                ("grant_type", oauth2_grant(grant_type)),
                ("authUrl", auth_url),
                ("accessTokenUrl", token_url),
                ("clientId", client_id),
                ("clientSecret", client_secret),
                ("scope", scope),
            ],
        )),
        AuthConfig::Digest {
            username, password, ..
        } => Some(pm(
            "digest",
            &[("username", username), ("password", password)],
        )),
        AuthConfig::Ntlm {
            username,
            password,
            domain,
            workstation,
            ..
        } => Some(pm(
            "ntlm",
            &[
                ("username", username),
                ("password", password),
                ("domain", domain),
                ("workstation", workstation),
            ],
        )),
    }
}

/// `{ "type": ty, ty: [{key,value,type:"string"}, …] }` — Postman's quirky auth shape.
fn pm(ty: &str, pairs: &[(&str, &str)]) -> Value {
    let params: Vec<Value> = pairs
        .iter()
        .map(|(k, v)| json!({ "key": k, "value": v, "type": "string" }))
        .collect();
    json!({ "type": ty, ty: params })
}

fn oauth1_sig(m: &OAuth1Signature) -> &'static str {
    match m {
        OAuth1Signature::HmacSha1 => "HMAC-SHA1",
        OAuth1Signature::HmacSha256 => "HMAC-SHA256",
        OAuth1Signature::HmacSha512 => "HMAC-SHA512",
        OAuth1Signature::RsaSha1 => "RSA-SHA1",
        OAuth1Signature::RsaSha256 => "RSA-SHA256",
        OAuth1Signature::RsaSha512 => "RSA-SHA512",
        OAuth1Signature::PlainText => "PLAINTEXT",
    }
}

fn oauth2_grant(g: &OAuth2Grant) -> &'static str {
    match g {
        OAuth2Grant::ClientCredentials => "client_credentials",
        OAuth2Grant::AuthorizationCode => "authorization_code",
        OAuth2Grant::Password => "password_credentials",
        OAuth2Grant::Implicit => "implicit",
    }
}
