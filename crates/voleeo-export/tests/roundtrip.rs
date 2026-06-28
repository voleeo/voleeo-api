//! Export round-trips. Builds a representative bundle and checks: Postman
//! re-parses through `voleeo-import` with auth fidelity the IR can't carry
//! (SigV4); the Voleeo Bundle preserves everything (incl. WS/gRPC) with secret
//! flags cleared; and AsyncAPI carries the WebSocket endpoints.

use serde_json::Value;
use voleeo_core::{
    ApiFolder, AuthConfig, BodyKind, Environment, EnvironmentKind, EnvironmentVariable,
    GrpcRequest, HttpRequest, ProtoSource, RequestBody, RequestParameter, VoleeoBundle, Workspace,
    WsConnection,
};
use voleeo_export::{postman_environments, to_asyncapi, to_postman, to_voleeo, Bundle};
use voleeo_import::{ImportFormat, ImportedItem};

fn ts() -> String {
    "2026-01-01T00:00:00.000Z".to_string()
}

fn param(name: &str, value: &str) -> RequestParameter {
    RequestParameter {
        id: format!("p-{name}"),
        name: name.into(),
        value: value.into(),
        enabled: true,
    }
}

fn http(
    name: &str,
    method: &str,
    url: &str,
    auth: AuthConfig,
    body: Option<RequestBody>,
    folder: Option<&str>,
) -> HttpRequest {
    HttpRequest {
        id: format!("r-{name}"),
        request_type: "api".into(),
        model: "http_request".into(),
        workspace_id: "ws00000001".into(),
        folder_id: folder.map(str::to_string),
        method: method.into(),
        name: name.into(),
        url: url.into(),
        parameters: vec![],
        headers: vec![],
        body,
        auth,
        order: 0.0,
        created_at: ts(),
        updated_at: ts(),
    }
}

fn bundle() -> Bundle {
    let workspace = Workspace {
        id: "ws00000001".into(),
        name: "Demo API".into(),
        model: "workspace".into(),
        encrypted: false,
        sync_dir: None,
        key_check: None,
        headers: vec![],
        auth: AuthConfig::None,
        dns_overrides: vec![],
        created_at: ts(),
        updated_at: ts(),
    };

    let folder = ApiFolder {
        id: "f-pets".into(),
        folder_type: "api".into(),
        model: "folder".into(),
        workspace_id: "ws00000001".into(),
        folder_id: None,
        name: "Pets".into(),
        headers: vec![],
        auth: AuthConfig::Bearer {
            token: "folder-token".into(),
            token_encrypted: false,
            enabled: true,
        },
        variables: vec![],
        color: None,
        order: 0.0,
        created_at: ts(),
        updated_at: ts(),
    };

    let mut get_pet = http(
        "Get Pet",
        "GET",
        "https://api.example.com/pets/:id",
        AuthConfig::Inherit {
            from: Default::default(),
        },
        None,
        Some("f-pets"),
    );
    get_pet.parameters = vec![param("id", "42"), param("limit", "10")];

    let login = http(
        "Login",
        "POST",
        "https://api.example.com/login",
        AuthConfig::Basic {
            username: "user".into(),
            password: "pw".into(),
            password_encrypted: false,
            enabled: true,
        },
        Some(RequestBody {
            kind: BodyKind::Json,
            text: r#"{"u":"a"}"#.into(),
            ..Default::default()
        }),
        None,
    );

    // SigV4 is dropped by the import IR — proves we map core auth directly.
    let signed = http(
        "Signed",
        "GET",
        "https://api.example.com/secure",
        AuthConfig::AwsSigV4 {
            access_key: "AKIA".into(),
            secret_key: "sig-secret".into(),
            secret_key_encrypted: false,
            session_token: String::new(),
            session_token_encrypted: false,
            region: "us-east-1".into(),
            service: "execute-api".into(),
            enabled: true,
        },
        None,
        None,
    );

    let ws = WsConnection {
        id: "w-1".into(),
        connection_type: "websocket".into(),
        model: "ws_connection".into(),
        workspace_id: "ws00000001".into(),
        folder_id: None,
        name: "Live".into(),
        url: "wss://api.example.com/live".into(),
        parameters: vec![],
        headers: vec![param("X-Token", "abc")],
        auth: AuthConfig::None,
        order: 0.0,
        created_at: ts(),
        updated_at: ts(),
    };

    let grpc = GrpcRequest {
        id: "g-1".into(),
        request_type: "grpc".into(),
        model: "grpc_request".into(),
        workspace_id: "ws00000001".into(),
        folder_id: None,
        name: "GetUser".into(),
        target: "api.example.com:443".into(),
        tls: true,
        proto_source: ProtoSource::Reflection,
        service: Some("user.v1.Users".into()),
        method: Some("Get".into()),
        metadata: vec![param("authorization", "Bearer t")],
        message: r#"{"id":"7"}"#.into(),
        auth: AuthConfig::None,
        order: 0.0,
        created_at: ts(),
        updated_at: ts(),
    };

    let env = Environment {
        id: "global".into(),
        workspace_id: "ws00000001".into(),
        kind: EnvironmentKind::Global,
        name: "Global".into(),
        color: "#fff".into(),
        shared: true,
        variables: vec![
            EnvironmentVariable {
                key: "BASE_URL".into(),
                value: "https://api.example.com".into(),
                encrypted: false,
                enabled: true,
            },
            // Already-decrypted secret (the command layer decrypts before export).
            EnvironmentVariable {
                key: "TOKEN".into(),
                value: "plain-secret".into(),
                encrypted: true,
                enabled: true,
            },
        ],
        created_at: ts(),
        updated_at: ts(),
    };

    Bundle {
        workspace,
        folders: vec![folder],
        requests: vec![get_pet, login, signed],
        ws: vec![ws],
        grpc: vec![grpc],
        environments: vec![env],
    }
}

#[test]
fn postman_round_trips_and_keeps_auth_fidelity() {
    let out = to_postman(&[bundle()]).unwrap();
    let v: Value = serde_json::from_str(&out.content).expect("valid JSON");

    // Single bundle → collection named after the workspace.
    assert_eq!(v["info"]["name"], "Demo API");

    // Auth + decrypted secrets the import IR would lose are present in the JSON.
    assert!(out.content.contains("awsv4"), "SigV4 auth type survives");
    assert!(out.content.contains("sig-secret"), "SigV4 secret decrypted");
    assert!(out.content.contains("folder-token"));
    assert!(out.content.contains("plain-secret"), "env secret decrypted");

    // Collection variables carry the env vars.
    let vars = v["variable"].as_array().unwrap();
    assert!(vars.iter().any(|x| x["key"] == "BASE_URL"));
    assert!(vars
        .iter()
        .any(|x| x["key"] == "TOKEN" && x["value"] == "plain-secret"));

    // WS + gRPC are NOT in the collection — they go to their own formats.
    assert!(!out.content.contains("wss://"), "WS not in the collection");
    assert!(
        !out.content.contains("user.v1.Users"),
        "gRPC not in the collection"
    );

    // Environments are also emitted as standalone Postman environment files.
    let envs = postman_environments(&[bundle()]).unwrap();
    assert_eq!(envs.len(), 1, "one env file for the Global environment");
    let env: Value = serde_json::from_str(&envs[0].content).unwrap();
    assert_eq!(env["_postman_variable_scope"], "environment");
    let names: Vec<&str> = env["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["key"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"BASE_URL") && names.contains(&"TOKEN"));

    // Re-import through voleeo-import: the top-level item is the workspace folder.
    let col = voleeo_import::parse(ImportFormat::Postman, &out.content).expect("reparse");
    let top = match &col.items[0] {
        ImportedItem::Folder(f) => f,
        _ => panic!("expected a workspace folder at the top level"),
    };
    assert_eq!(top.name, "Demo API");
    // Inside: the Pets folder + two root requests (Login, Signed).
    assert!(top
        .items
        .iter()
        .any(|i| matches!(i, ImportedItem::Folder(f) if f.name == "Pets")));
}

#[test]
fn voleeo_bundle_round_trips_fully() {
    let out = to_voleeo(&[bundle()]).unwrap();
    let doc: VoleeoBundle = serde_yaml::from_str(&out.content).expect("valid Voleeo Bundle YAML");

    assert_eq!(doc.voleeo_bundle, "1.0");
    assert_eq!(doc.workspaces.len(), 1);
    let w = &doc.workspaces[0];
    assert_eq!(w.workspace.name, "Demo API");
    assert!(!w.workspace.encrypted, "export is plaintext / unencrypted");

    // Everything survives — including the WS + gRPC that Postman/OpenAPI drop.
    assert_eq!(w.folders.len(), 1);
    assert_eq!(w.requests.len(), 3);
    assert_eq!(w.websockets.len(), 1);
    assert_eq!(w.websockets[0].url, "wss://api.example.com/live");
    assert_eq!(w.grpc.len(), 1);
    assert_eq!(w.grpc[0].service.as_deref(), Some("user.v1.Users"));
    assert_eq!(w.environments.len(), 1);

    // Secret values are plaintext and their encrypted flags are cleared so an
    // unencrypted import doesn't trip the encryption guard.
    let token = w.environments[0]
        .variables
        .iter()
        .find(|v| v.key == "TOKEN")
        .unwrap();
    assert_eq!(token.value, "plain-secret");
    assert!(
        !token.encrypted,
        "env secret flag cleared on plaintext export"
    );

    let signed = w.requests.iter().find(|r| r.name == "Signed").unwrap();
    match &signed.auth {
        AuthConfig::AwsSigV4 {
            secret_key,
            secret_key_encrypted,
            ..
        } => {
            assert_eq!(secret_key, "sig-secret");
            assert!(!secret_key_encrypted, "auth secret flag cleared");
        }
        _ => panic!("expected SigV4 auth to survive"),
    }
}

#[test]
fn asyncapi_carries_websocket_endpoints() {
    let out = to_asyncapi(&bundle()).unwrap();
    let v: Value = serde_yaml::from_str(&out.content).expect("valid YAML");
    assert_eq!(v["asyncapi"], "2.6.0");
    // The wss://api.example.com/live connection → a server + the /live channel.
    assert_eq!(v["servers"]["api_example_com"]["protocol"], "wss");
    assert!(v["channels"]["/live"].is_object());
}
