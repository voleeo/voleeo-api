//! Fixture-driven tests for the OpenAPI parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, RawKind,
};

const PETSTORE: &str = include_str!("fixtures/openapi/petstore.yaml");

fn petstore() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::OpenApi, PETSTORE).unwrap()
}

#[test]
fn detects_openapi() {
    assert_eq!(detect_format(PETSTORE), Some(ImportFormat::OpenApi));
}

#[test]
fn maps_name_and_base_url() {
    let col = petstore();
    assert_eq!(col.name, "Swagger Petstore");
    let base = col.variables.iter().find(|v| v.key == "base_url").unwrap();
    // Server variable default `{basePath}` → `v2`.
    assert_eq!(base.value, "https://api.example.com/v2");
    // A second server should produce a warning, not a second base_url.
    assert!(col.warnings.iter().any(|w| w.contains("first server")));
}

#[test]
fn groups_requests_into_tag_folders() {
    let col = petstore();
    let folders: Vec<&str> = col
        .items
        .iter()
        .filter_map(|i| match i {
            ImportedItem::Folder(f) => Some(f.name.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(folders, vec!["pets", "store"]);

    let pets = col
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "pets" => Some(f),
            _ => None,
        })
        .unwrap();
    // /pets (list, create) + /pets/{petId} (get) — the single-op {petId} leaf
    // collapses into the pets folder rather than nesting.
    assert_eq!(pets.items.len(), 3);
}

#[test]
fn nests_multi_op_path_into_subfolder() {
    // `/pet/{id}` has 2 ops → an `{id}` subfolder under `pet`; `/pet` GET stays
    // directly in `pet`.
    let spec = r#"{"openapi":"3.0.0","info":{"title":"x","version":"1"},
      "paths":{
        "/pet":{"get":{"summary":"list"}},
        "/pet/{id}":{"get":{"summary":"get"},"delete":{"summary":"del"}}}}"#;
    let col = parse(ImportFormat::OpenApi, spec).unwrap();
    let pet = col
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "pet" => Some(f),
            _ => None,
        })
        .unwrap();
    let sub = pet
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "{id}" => Some(f),
            _ => None,
        })
        .unwrap();
    assert_eq!(sub.items.len(), 2);
}

#[test]
fn requests_carry_raw_display_path() {
    let col = petstore();
    let get_by_id = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Get a pet")
        .unwrap();
    // Raw template path (braces) is preserved for display/search, distinct from
    // the resolved `:petId` URL.
    assert_eq!(get_by_id.path, "/pets/{petId}");
    assert_eq!(get_by_id.url, "{{ base_url }}/pets/:petId");
}

#[test]
fn rewrites_path_params_and_classifies_query_headers() {
    let col = petstore();
    let reqs = all_requests(&col);

    let get_by_id = reqs.iter().find(|r| r.name == "Get a pet").unwrap();
    assert_eq!(get_by_id.url, "{{ base_url }}/pets/:petId");
    assert_eq!(get_by_id.path_params.len(), 1);
    assert_eq!(get_by_id.path_params[0].name, "petId");

    let list = reqs.iter().find(|r| r.name == "List pets").unwrap();
    assert!(list.query.iter().any(|p| p.name == "limit" && !p.enabled));
    assert!(list
        .headers
        .iter()
        .any(|h| h.name == "X-Request-Id" && h.enabled));
}

#[test]
fn json_body_example_is_synthesized() {
    let col = petstore();
    let create = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Create a pet")
        .unwrap();
    let Some(ImportedBody::Raw {
        hint: RawKind::Json,
        text,
    }) = &create.body
    else {
        panic!("expected JSON body, got {:?}", create.body);
    };
    let v: serde_json::Value = serde_json::from_str(text).unwrap();
    assert!(v.get("name").is_some());
    assert!(v.get("age").is_some());
}

#[test]
fn security_maps_global_and_operation_override() {
    let col = petstore();
    // Global security → ApiKey in header.
    assert!(matches!(
        col.root_auth,
        ImportedAuth::ApiKey {
            in_header: true,
            ..
        }
    ));

    let create = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Create a pet")
        .unwrap();
    // Operation override → OAuth2 with the token URL from the flow.
    let ImportedAuth::OAuth2 { token_url, .. } = &create.auth else {
        panic!("expected OAuth2 on create, got {:?}", create.auth);
    };
    assert_eq!(token_url, "https://api.example.com/oauth/token");

    // Operations without their own security inherit.
    let list = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "List pets")
        .unwrap();
    assert!(matches!(list.auth, ImportedAuth::Inherit));
}

fn all_requests(col: &voleeo_import::ImportedCollection) -> Vec<voleeo_import::ImportedRequest> {
    fn walk(items: &[ImportedItem], out: &mut Vec<voleeo_import::ImportedRequest>) {
        for it in items {
            match it {
                ImportedItem::Request(r) => out.push(r.clone()),
                ImportedItem::Folder(f) => walk(&f.items, out),
            }
        }
    }
    let mut out = Vec::new();
    walk(&col.items, &mut out);
    out
}
