//! HTTP/WS request application: substitute path params, build the query string,
//! resolve `{{ VAR }}` in headers/body, and map `auth` to a header/query param
//! (static schemes) or resolve its `{{ }}` fields in place (dynamic/OAuth2).
//! Backend mirror of `sendResolution.ts`; the pipeline is numbered inline in
//! `apply_to_request`.

use std::collections::HashMap;

use voleeo_core::{ApiKeyLocation, AuthConfig, HttpRequest, RequestParameter, WsConnection};

use super::text::{
    base64_encode, extract_path_params, replace_path_param, strip_query, url_encode,
};
use super::vars::resolve_str;

/// Substitute `:params`, resolve `{{ }}` in the base URL, and build the query
/// string from the non-path enabled parameters. Shared by HTTP requests and WS
/// connections — both carry `url` + `parameters`.
fn resolve_url_and_query(
    url: &str,
    parameters: &[RequestParameter],
    vars: &HashMap<String, String>,
) -> (String, Vec<String>) {
    let path_param_names = extract_path_params(url);

    let mut resolved_base = strip_query(url).to_string();
    for param in parameters
        .iter()
        .filter(|p| p.enabled && path_param_names.contains(&p.name))
    {
        let val = url_encode(&resolve_str(&param.value, vars));
        resolved_base = replace_path_param(&resolved_base, &param.name, &val);
    }
    resolved_base = resolve_str(&resolved_base, vars);

    let query_parts = parameters
        .iter()
        .filter(|p| p.enabled && !p.name.trim().is_empty() && !path_param_names.contains(&p.name))
        .map(|p| {
            let k = url_encode(&resolve_str(&p.name, vars));
            let v = resolve_str(&p.value, vars);
            if v.is_empty() {
                k
            } else {
                format!("{k}={}", url_encode(&v))
            }
        })
        .collect();

    (resolved_base, query_parts)
}

/// Apply full template resolution to a request in-place before execution.
pub fn apply_to_request(req: &mut HttpRequest, vars: &HashMap<String, String>) {
    // 1–3: substitute :params, resolve {{ }} in the base URL, build the query.
    let (resolved_base, mut query_parts) = resolve_url_and_query(&req.url, &req.parameters, vars);

    // 4: resolve headers in-place.
    for h in req.headers.iter_mut() {
        if !h.enabled || h.name.trim().is_empty() {
            continue;
        }
        h.name = resolve_str(&h.name, vars);
        h.value = resolve_str(&h.value, vars);
    }

    // 5: resolve body — raw text and form/multipart field values. File paths
    // (multipart file fields, binary) are left untouched.
    if let Some(body) = &mut req.body {
        if !matches!(body.kind, voleeo_core::BodyKind::None) {
            body.text = resolve_str(&body.text, vars);
            if let Some(vars_text) = body.graphql_variables.as_mut() {
                *vars_text = resolve_str(vars_text, vars);
            }
            if let Some(fields) = body.fields.as_mut() {
                for f in fields.iter_mut() {
                    f.name = resolve_str(&f.name, vars);
                    if !f.is_file {
                        f.value = resolve_str(&f.value, vars);
                    }
                }
            }
        }
    }

    // 6: resolve auth. A disabled (toggled-off) scheme applies nothing. Dynamic
    // schemes (SigV4) are signed by the executor over the final request, so we
    // only resolve their `{{ }}` fields in place and leave `req.auth` for the
    // executor. Static schemes become a header/query param here, then `req.auth`
    // is cleared so the executor never re-applies.
    if !req.auth.is_active() {
        req.auth = AuthConfig::None;
    } else if req.auth.is_dynamic() {
        resolve_dynamic_auth(&mut req.auth, vars);
    } else if matches!(req.auth, AuthConfig::OAuth2 { .. }) {
        // Resolve `{{ }}` in place and leave `req.auth` — the async send handler
        // exchanges the cached token for a Bearer header (network/cache access
        // can't happen in this sync resolver).
        resolve_oauth2_auth(&mut req.auth, vars);
    } else {
        match &req.auth.clone() {
            AuthConfig::Bearer { token, .. } => {
                let t = resolve_str(token, vars);
                req.headers
                    .push(auth_header("Authorization", format!("Bearer {t}")));
            }
            AuthConfig::Basic {
                username, password, ..
            } => {
                let u = resolve_str(username, vars);
                let p = resolve_str(password, vars);
                let encoded = base64_encode(format!("{u}:{p}").as_bytes());
                req.headers
                    .push(auth_header("Authorization", format!("Basic {encoded}")));
            }
            AuthConfig::ApiKey {
                key,
                value,
                location,
                ..
            } => {
                let k = resolve_str(key, vars);
                let v = resolve_str(value, vars);
                if !k.trim().is_empty() {
                    match location {
                        ApiKeyLocation::Header => {
                            req.headers.push(auth_header(k, v));
                        }
                        ApiKeyLocation::Query => {
                            query_parts.push(format!("{}={}", url_encode(&k), url_encode(&v)));
                        }
                    }
                }
            }
            // Inherit is resolved by the frontend before sending. When the MCP
            // server sends a stored request directly it has no folder/workspace
            // context, so treat unresolved inherit as "no auth".
            AuthConfig::None | AuthConfig::Inherit { .. } => {}
            // Dynamic schemes are handled above; unreachable here.
            AuthConfig::AwsSigV4 { .. }
            | AuthConfig::OAuth1 { .. }
            | AuthConfig::OAuth2 { .. }
            | AuthConfig::Digest { .. }
            | AuthConfig::Ntlm { .. } => {}
        }
        req.auth = AuthConfig::None;
    }

    req.url = if query_parts.is_empty() {
        resolved_base
    } else {
        format!("{}?{}", resolved_base, query_parts.join("&"))
    };
}

/// WS equivalent of `apply_to_request`: resolved URL + handshake headers.
pub fn apply_to_connection(
    conn: &WsConnection,
    vars: &HashMap<String, String>,
) -> (String, Vec<(String, String)>) {
    let (resolved_base, mut query_parts) = resolve_url_and_query(&conn.url, &conn.parameters, vars);

    let mut headers: Vec<(String, String)> = conn
        .headers
        .iter()
        .filter(|h| h.enabled && !h.name.trim().is_empty())
        .map(|h| (resolve_str(&h.name, vars), resolve_str(&h.value, vars)))
        .collect();

    // A disabled (toggled-off) scheme applies nothing.
    let none = AuthConfig::None;
    let effective_auth = if conn.auth.is_active() {
        &conn.auth
    } else {
        &none
    };
    match effective_auth {
        AuthConfig::Bearer { token, .. } => {
            headers.push((
                "Authorization".into(),
                format!("Bearer {}", resolve_str(token, vars)),
            ));
        }
        AuthConfig::Basic {
            username, password, ..
        } => {
            let encoded = base64_encode(
                format!(
                    "{}:{}",
                    resolve_str(username, vars),
                    resolve_str(password, vars)
                )
                .as_bytes(),
            );
            headers.push(("Authorization".into(), format!("Basic {encoded}")));
        }
        AuthConfig::ApiKey {
            key,
            value,
            location,
            ..
        } => {
            let k = resolve_str(key, vars);
            let v = resolve_str(value, vars);
            if !k.trim().is_empty() {
                match location {
                    ApiKeyLocation::Header => headers.push((k, v)),
                    ApiKeyLocation::Query => {
                        query_parts.push(format!("{}={}", url_encode(&k), url_encode(&v)));
                    }
                }
            }
        }
        AuthConfig::None | AuthConfig::Inherit { .. } => {}
        // SigV4 is HTTP-only; a WS connection inheriting it sends no auth.
        AuthConfig::AwsSigV4 { .. }
        | AuthConfig::OAuth1 { .. }
        | AuthConfig::OAuth2 { .. }
        | AuthConfig::Digest { .. }
        | AuthConfig::Ntlm { .. } => {}
    }

    let url = if query_parts.is_empty() {
        resolved_base
    } else {
        format!("{}?{}", resolved_base, query_parts.join("&"))
    };
    (url, headers)
}

/// Resolve `{{ VAR }}` in every field of a dynamic auth scheme in place. The
/// executor signs the request later using the resolved config. Extend the match
/// as new dynamic schemes are added.
fn resolve_dynamic_auth(auth: &mut AuthConfig, vars: &HashMap<String, String>) {
    match auth {
        AuthConfig::AwsSigV4 {
            access_key,
            secret_key,
            session_token,
            region,
            service,
            ..
        } => {
            *access_key = resolve_str(access_key, vars);
            *secret_key = resolve_str(secret_key, vars);
            *session_token = resolve_str(session_token, vars);
            *region = resolve_str(region, vars);
            *service = resolve_str(service, vars);
        }
        AuthConfig::OAuth1 {
            consumer_key,
            consumer_secret,
            token,
            token_secret,
            realm,
            private_key,
            callback,
            verifier,
            timestamp,
            nonce,
            version,
            ..
        } => {
            *consumer_key = resolve_str(consumer_key, vars);
            *consumer_secret = resolve_str(consumer_secret, vars);
            *token = resolve_str(token, vars);
            *token_secret = resolve_str(token_secret, vars);
            *realm = resolve_str(realm, vars);
            *private_key = resolve_str(private_key, vars);
            *callback = resolve_str(callback, vars);
            *verifier = resolve_str(verifier, vars);
            *timestamp = resolve_str(timestamp, vars);
            *nonce = resolve_str(nonce, vars);
            *version = resolve_str(version, vars);
        }
        AuthConfig::Digest {
            username, password, ..
        } => {
            *username = resolve_str(username, vars);
            *password = resolve_str(password, vars);
        }
        AuthConfig::Ntlm {
            username,
            password,
            domain,
            workstation,
            ..
        } => {
            *username = resolve_str(username, vars);
            *password = resolve_str(password, vars);
            *domain = resolve_str(domain, vars);
            *workstation = resolve_str(workstation, vars);
        }
        _ => {}
    }
}

/// Resolve `{{ VAR }}` in an OAuth 2.0 config's template fields in place. The
/// async send handler then exchanges the cached token for a Bearer header.
fn resolve_oauth2_auth(auth: &mut AuthConfig, vars: &HashMap<String, String>) {
    if let AuthConfig::OAuth2 {
        auth_url,
        token_url,
        client_id,
        client_secret,
        scope,
        audience,
        username,
        password,
        code_verifier,
        ..
    } = auth
    {
        *auth_url = resolve_str(auth_url, vars);
        *token_url = resolve_str(token_url, vars);
        *client_id = resolve_str(client_id, vars);
        *client_secret = resolve_str(client_secret, vars);
        *scope = resolve_str(scope, vars);
        *audience = resolve_str(audience, vars);
        *username = resolve_str(username, vars);
        *password = resolve_str(password, vars);
        *code_verifier = resolve_str(code_verifier, vars);
    }
}

pub(crate) fn auth_header(name: impl Into<String>, value: impl Into<String>) -> RequestParameter {
    RequestParameter {
        id: "__auth".into(),
        name: name.into(),
        value: value.into(),
        enabled: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn bare_request(url: &str) -> HttpRequest {
        HttpRequest {
            id: "r1".into(),
            request_type: "http".into(),
            model: "request".into(),
            workspace_id: "ws".into(),
            folder_id: None,
            method: "GET".into(),
            name: "Test".into(),
            url: url.into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    fn param(name: &str, value: &str, enabled: bool) -> RequestParameter {
        RequestParameter {
            id: "p".into(),
            name: name.into(),
            value: value.into(),
            enabled,
        }
    }

    #[test]
    fn apply_path_param_substitution() {
        let v = vars(&[("USER_ID", "42")]);
        let mut req = bare_request("https://api.example.com/users/:id/profile");
        req.parameters = vec![param("id", "{{ USER_ID }}", true)];
        apply_to_request(&mut req, &v);
        assert_eq!(req.url, "https://api.example.com/users/42/profile");
    }

    #[test]
    fn apply_query_params_appended() {
        let v = vars(&[("Q", "hello world")]);
        let mut req = bare_request("https://api.example.com/search");
        req.parameters = vec![param("q", "{{ Q }}", true), param("page", "1", true)];
        apply_to_request(&mut req, &v);
        assert!(
            req.url.contains("q=hello%20world"),
            "query value should be encoded: {}",
            req.url
        );
        assert!(
            req.url.contains("page=1"),
            "second param should appear: {}",
            req.url
        );
    }

    #[test]
    fn apply_disabled_query_params_excluded() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.parameters = vec![param("active", "yes", true), param("ignored", "no", false)];
        apply_to_request(&mut req, &v);
        assert!(req.url.contains("active=yes"));
        assert!(!req.url.contains("ignored"));
    }

    #[test]
    fn apply_bearer_auth_injects_authorization_header() {
        let v = vars(&[("TOKEN", "my-secret")]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Bearer {
            token: "{{ TOKEN }}".into(),
            token_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let auth_header = req.headers.iter().find(|h| h.name == "Authorization");
        assert!(
            auth_header.is_some(),
            "Authorization header should be injected"
        );
        assert_eq!(auth_header.unwrap().value, "Bearer my-secret");
    }

    #[test]
    fn apply_disabled_auth_injects_nothing() {
        let v = vars(&[("TOKEN", "my-secret")]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Bearer {
            token: "{{ TOKEN }}".into(),
            token_encrypted: false,
            enabled: false,
        };
        apply_to_request(&mut req, &v);
        assert!(
            req.headers.iter().all(|h| h.name != "Authorization"),
            "disabled auth must not inject a header"
        );
        assert!(matches!(req.auth, AuthConfig::None));
    }

    #[test]
    fn apply_basic_auth_base64_encodes() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::Basic {
            username: "user".into(),
            password: "pass".into(),
            password_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let auth_header = req
            .headers
            .iter()
            .find(|h| h.name == "Authorization")
            .unwrap();
        // "user:pass" → base64 → "dXNlcjpwYXNz"
        assert_eq!(auth_header.value, "Basic dXNlcjpwYXNz");
    }

    #[test]
    fn apply_api_key_as_header() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/");
        req.auth = AuthConfig::ApiKey {
            key: "X-Api-Key".into(),
            value: "secret".into(),
            location: ApiKeyLocation::Header,
            value_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        let h = req.headers.iter().find(|h| h.name == "X-Api-Key").unwrap();
        assert_eq!(h.value, "secret");
    }

    #[test]
    fn apply_api_key_as_query_param() {
        let v = vars(&[]);
        let mut req = bare_request("https://api.example.com/data");
        req.auth = AuthConfig::ApiKey {
            key: "apikey".into(),
            value: "tok".into(),
            location: ApiKeyLocation::Query,
            value_encrypted: false,
            enabled: true,
        };
        apply_to_request(&mut req, &v);
        assert!(
            req.url.contains("apikey=tok"),
            "api key should appear in query: {}",
            req.url
        );
    }
}
