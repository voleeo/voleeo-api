/// A parsed collection ready to convert. `items` preserves source order; the
/// converter assigns ids/timestamps and wires `folder_id` from the tree.
#[derive(Debug, Clone, Default)]
pub struct ImportedCollection {
    pub name: String,
    /// Source spec version (e.g. `3.0.3`), shown in the preview subtitle.
    pub version: Option<String>,
    /// Collection/base variables → the workspace's Global environment.
    pub variables: Vec<ImportedVariable>,
    /// Named sub-environments (dev/staging/…) → one Voleeo environment each.
    pub environments: Vec<ImportedEnvironment>,
    /// Collection-level / global security → workspace auth (new workspace only).
    pub root_auth: ImportedAuth,
    pub items: Vec<ImportedItem>,
    /// Unsupported features surfaced to the user (skipped scripts, external refs…).
    pub warnings: Vec<String>,
}

/// A named environment from the source (Insomnia sub-env, Yaak sub-env, Bruno
/// `config.environments` entry) → its own Voleeo environment on import.
#[derive(Debug, Clone)]
pub struct ImportedEnvironment {
    pub name: String,
    pub variables: Vec<ImportedVariable>,
}

#[derive(Debug, Clone)]
pub enum ImportedItem {
    Folder(ImportedFolder),
    Request(ImportedRequest),
}

#[derive(Debug, Clone, Default)]
pub struct ImportedFolder {
    pub name: String,
    /// Tag/group description, shown beside the folder name in the preview.
    pub description: Option<String>,
    pub auth: ImportedAuth,
    pub headers: Vec<ImportedParam>,
    pub variables: Vec<ImportedVariable>,
    pub items: Vec<ImportedItem>,
}

#[derive(Debug, Clone, Default)]
pub struct ImportedRequest {
    pub name: String,
    pub method: String,
    /// URL with `:name` path-param segments and `{{ base_url }}`-style prefixes.
    pub url: String,
    /// Raw source path (`/pet/{petId}`) for display/search in the preview.
    pub path: String,
    /// Path params (`:name`) — empty value, the user fills them in.
    pub path_params: Vec<ImportedParam>,
    pub query: Vec<ImportedParam>,
    pub headers: Vec<ImportedParam>,
    pub body: Option<ImportedBody>,
    pub auth: ImportedAuth,
}

#[derive(Debug, Clone)]
pub struct ImportedParam {
    pub name: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct ImportedVariable {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum ImportedBody {
    Raw {
        hint: RawKind,
        text: String,
    },
    FormUrlEncoded(Vec<ImportedField>),
    Multipart(Vec<ImportedField>),
    Binary,
    GraphQl {
        query: String,
        variables: Option<String>,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum RawKind {
    Json,
    Xml,
    Text,
    Html,
}

#[derive(Debug, Clone)]
pub struct ImportedField {
    pub name: String,
    pub value: String,
    pub is_file: bool,
    pub enabled: bool,
}

/// Auth schemes the IR can carry. `convert::to_auth` maps these onto
/// `voleeo_core::AuthConfig`; `Unsupported` becomes `None` plus a warning.
#[derive(Debug, Clone, Default)]
pub enum ImportedAuth {
    #[default]
    None,
    Inherit,
    Bearer {
        token: String,
    },
    Basic {
        username: String,
        password: String,
    },
    ApiKey {
        key: String,
        value: String,
        in_header: bool,
    },
    OAuth2 {
        grant: OAuth2GrantKind,
        auth_url: String,
        token_url: String,
        client_id: String,
        client_secret: String,
        scope: String,
    },
    Unsupported(String),
}

#[derive(Debug, Clone, Copy, Default)]
pub enum OAuth2GrantKind {
    #[default]
    ClientCredentials,
    AuthorizationCode,
    Password,
    Implicit,
}
