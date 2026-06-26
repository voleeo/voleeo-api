use crate::ir::*;
use std::collections::HashSet;
use voleeo_core::{
    new_id, now_iso, ApiFolder, ApiKeyLocation, AuthConfig, BodyField, BodyKind,
    EnvironmentVariable, HttpRequest, OAuth2ClientAuth, OAuth2Grant, OAuth2PkceMethod, RequestBody,
    RequestParameter,
};

/// Fully-built structs ready for `RequestStore::write_bulk` + an "Imported" env.
pub struct ConvertedPlan {
    pub folders: Vec<ApiFolder>,
    pub requests: Vec<HttpRequest>,
    pub variables: Vec<EnvironmentVariable>,
    pub root_auth: AuthConfig,
    pub warnings: Vec<String>,
}

/// Build the persistence plan. `order_base` seeds `order` (new workspaces use
/// `timestamp_millis`; existing ones use `max_sibling_order + 1` to append).
pub fn build_plan(workspace_id: &str, order_base: f64, col: &ImportedCollection) -> ConvertedPlan {
    let mut plan = ConvertedPlan {
        folders: Vec::new(),
        requests: Vec::new(),
        variables: col.variables.iter().map(to_env_var).collect(),
        root_auth: to_auth(&col.root_auth),
        warnings: col.warnings.clone(),
    };
    let mut counter = 0f64;
    convert_items(
        workspace_id,
        &col.items,
        None,
        order_base,
        &mut counter,
        &mut plan,
    );
    plan
}

fn convert_items(
    ws: &str,
    items: &[ImportedItem],
    parent: Option<&str>,
    base: f64,
    counter: &mut f64,
    plan: &mut ConvertedPlan,
) {
    for item in items {
        let order = base + *counter;
        *counter += 1.0;
        match item {
            ImportedItem::Folder(f) => {
                let id = new_id();
                let now = now_iso();
                plan.folders.push(ApiFolder {
                    id: id.clone(),
                    folder_type: "api".to_string(),
                    model: "folder".to_string(),
                    workspace_id: ws.to_string(),
                    folder_id: parent.map(str::to_string),
                    name: f.name.clone(),
                    headers: to_params(&f.headers),
                    auth: to_auth(&f.auth),
                    variables: f.variables.iter().map(to_env_var).collect(),
                    color: None,
                    order,
                    created_at: now.clone(),
                    updated_at: now,
                });
                convert_items(ws, &f.items, Some(&id), base, counter, plan);
            }
            ImportedItem::Request(r) => {
                let now = now_iso();
                let mut parameters = to_params(&r.path_params);
                parameters.extend(to_params(&r.query));
                plan.requests.push(HttpRequest {
                    id: new_id(),
                    request_type: "api".to_string(),
                    model: "http_request".to_string(),
                    workspace_id: ws.to_string(),
                    folder_id: parent.map(str::to_string),
                    method: r.method.clone(),
                    name: r.name.clone(),
                    url: r.url.clone(),
                    parameters,
                    headers: to_params(&r.headers),
                    body: to_body(r.body.as_ref()),
                    auth: to_auth(&r.auth),
                    order,
                    created_at: now.clone(),
                    updated_at: now,
                });
            }
        }
    }
}

fn to_env_var(v: &ImportedVariable) -> EnvironmentVariable {
    EnvironmentVariable {
        key: v.key.clone(),
        value: v.value.clone(),
        encrypted: false,
        enabled: true,
    }
}

fn to_params(params: &[ImportedParam]) -> Vec<RequestParameter> {
    params
        .iter()
        .map(|p| RequestParameter {
            id: new_id(),
            name: p.name.clone(),
            value: p.value.clone(),
            enabled: p.enabled,
        })
        .collect()
}

fn to_body(body: Option<&ImportedBody>) -> Option<RequestBody> {
    let body = body?;
    let built = match body {
        ImportedBody::Raw { hint, text } => RequestBody {
            kind: match hint {
                RawKind::Json => BodyKind::Json,
                RawKind::Xml => BodyKind::Xml,
                RawKind::Text => BodyKind::Text,
                RawKind::Html => BodyKind::Html,
            },
            text: text.clone(),
            ..Default::default()
        },
        ImportedBody::FormUrlEncoded(fields) => RequestBody {
            kind: BodyKind::FormUrlEncoded,
            fields: Some(to_fields(fields)),
            ..Default::default()
        },
        ImportedBody::Multipart(fields) => RequestBody {
            kind: BodyKind::Multipart,
            fields: Some(to_fields(fields)),
            ..Default::default()
        },
        ImportedBody::Binary => RequestBody {
            kind: BodyKind::Binary,
            ..Default::default()
        },
        ImportedBody::GraphQl { query, variables } => RequestBody {
            kind: BodyKind::Graphql,
            text: query.clone(),
            graphql_variables: variables.clone(),
            ..Default::default()
        },
    };
    Some(built)
}

fn to_fields(fields: &[ImportedField]) -> Vec<BodyField> {
    fields
        .iter()
        .map(|f| BodyField {
            id: new_id(),
            name: f.name.clone(),
            value: f.value.clone(),
            enabled: f.enabled,
            is_file: f.is_file,
            content_type: None,
        })
        .collect()
}

fn to_auth(auth: &ImportedAuth) -> AuthConfig {
    match auth {
        ImportedAuth::None | ImportedAuth::Unsupported(_) => AuthConfig::None,
        ImportedAuth::Inherit => AuthConfig::Inherit {
            from: Default::default(),
        },
        ImportedAuth::Bearer { token } => AuthConfig::Bearer {
            token: token.clone(),
            token_encrypted: false,
            enabled: true,
        },
        ImportedAuth::Basic { username, password } => AuthConfig::Basic {
            username: username.clone(),
            password: password.clone(),
            password_encrypted: false,
            enabled: true,
        },
        ImportedAuth::ApiKey {
            key,
            value,
            in_header,
        } => AuthConfig::ApiKey {
            key: key.clone(),
            value: value.clone(),
            location: if *in_header {
                ApiKeyLocation::Header
            } else {
                ApiKeyLocation::Query
            },
            value_encrypted: false,
            enabled: true,
        },
        ImportedAuth::OAuth2 {
            grant,
            auth_url,
            token_url,
            client_id,
            client_secret,
            scope,
        } => AuthConfig::OAuth2 {
            grant_type: match grant {
                OAuth2GrantKind::ClientCredentials => OAuth2Grant::ClientCredentials,
                OAuth2GrantKind::AuthorizationCode => OAuth2Grant::AuthorizationCode,
                OAuth2GrantKind::Password => OAuth2Grant::Password,
                OAuth2GrantKind::Implicit => OAuth2Grant::Implicit,
            },
            auth_url: auth_url.clone(),
            token_url: token_url.clone(),
            client_id: client_id.clone(),
            client_secret: client_secret.clone(),
            client_secret_encrypted: false,
            scope: scope.clone(),
            audience: String::new(),
            client_auth: OAuth2ClientAuth::BasicHeader,
            use_pkce: true,
            code_challenge_method: OAuth2PkceMethod::S256,
            code_verifier: String::new(),
            redirect_uri: String::new(),
            state: String::new(),
            username: String::new(),
            password: String::new(),
            password_encrypted: false,
            use_external_browser: false,
            enabled: true,
        },
    }
}

// ── Preview tree + selection filter (shared positional-id scheme) ────────────
//
// A node's id is its index path from the root, joined by `.` (`"0"`, `"0.1"`,
// `"2"`). Parsing is deterministic, so the same id addresses the same node on
// the preview pass and the commit pass — selection round-trips without server
// state.

/// One preview node the UI renders as a checkbox tree.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportNode {
    pub id: String,
    /// `"folder"` | `"request"`.
    pub kind: String,
    pub name: String,
    /// Request HTTP method (folders have none).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// Request source path (`/pet/{petId}`); folders have none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Folder/tag description; requests have none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub children: Vec<ImportNode>,
}

pub fn preview_nodes(items: &[ImportedItem]) -> Vec<ImportNode> {
    build_nodes(items, "")
}

fn build_nodes(items: &[ImportedItem], prefix: &str) -> Vec<ImportNode> {
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let id = format!("{prefix}{i}");
            match item {
                ImportedItem::Folder(f) => ImportNode {
                    children: build_nodes(&f.items, &format!("{id}.")),
                    id,
                    kind: "folder".to_string(),
                    name: f.name.clone(),
                    method: None,
                    path: None,
                    description: f.description.clone(),
                },
                ImportedItem::Request(r) => ImportNode {
                    id,
                    kind: "request".to_string(),
                    name: r.name.clone(),
                    method: Some(r.method.clone()),
                    path: Some(r.path.clone()),
                    description: None,
                    children: Vec::new(),
                },
            }
        })
        .collect()
}

/// Keep only the selected nodes. A request survives when its id is selected; a
/// folder survives when it has surviving children (or is an explicitly-selected
/// empty folder). `selected` ids use the `preview_nodes` scheme.
pub fn filter_items(items: &[ImportedItem], selected: &HashSet<String>) -> Vec<ImportedItem> {
    filter_inner(items, selected, "")
}

fn filter_inner(
    items: &[ImportedItem],
    selected: &HashSet<String>,
    prefix: &str,
) -> Vec<ImportedItem> {
    let mut out = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let id = format!("{prefix}{i}");
        match item {
            ImportedItem::Request(_) => {
                if selected.contains(&id) {
                    out.push(item.clone());
                }
            }
            ImportedItem::Folder(f) => {
                let kids = filter_inner(&f.items, selected, &format!("{id}."));
                if !kids.is_empty() || (f.items.is_empty() && selected.contains(&id)) {
                    let mut nf = f.clone();
                    nf.items = kids;
                    out.push(ImportedItem::Folder(nf));
                }
            }
        }
    }
    out
}
