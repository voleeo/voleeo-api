//! Fixture-driven tests for the Swagger 2.0 parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, OAuth2GrantKind,
    RawKind,
};

const PETSTORE: &str = include_str!("fixtures/swagger/petstore.yaml");

fn petstore() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::Swagger2, PETSTORE).unwrap()
}

#[test]
fn detects_swagger2() {
    assert_eq!(detect_format(PETSTORE), Some(ImportFormat::Swagger2));
}

#[test]
fn maps_name_version_and_base_url() {
    let col = petstore();
    assert_eq!(col.name, "Swagger Petstore");
    assert_eq!(col.version.as_deref(), Some("2.0"));
    let base = col.variables.iter().find(|v| v.key == "base_url").unwrap();
    assert_eq!(base.value, "https://petstore.swagger.io/v2");
}

#[test]
fn groups_requests_into_path_folders() {
    let col = petstore();
    let folders: Vec<&str> = col
        .items
        .iter()
        .filter_map(|i| match i {
            ImportedItem::Folder(f) => Some(f.name.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(folders, vec!["pet", "store"]);
}

#[test]
fn rewrites_path_params_and_query() {
    let col = petstore();
    let reqs = all_requests(&col);

    let by_id = reqs.iter().find(|r| r.name == "Find pet by ID").unwrap();
    assert_eq!(by_id.url, "{{ base_url }}/pet/:petId");
    assert_eq!(by_id.path_params.len(), 1);
    assert_eq!(by_id.path_params[0].name, "petId");

    let inv = reqs
        .iter()
        .find(|r| r.name == "Returns pet inventories by status")
        .unwrap();
    assert!(inv.query.iter().any(|p| p.name == "status" && !p.enabled));
}

#[test]
fn body_param_synthesizes_json_example() {
    let col = petstore();
    let add = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Add a new pet to the store")
        .unwrap();
    let Some(ImportedBody::Raw {
        hint: RawKind::Json,
        text,
    }) = &add.body
    else {
        panic!("expected JSON body, got {:?}", add.body);
    };
    let v: serde_json::Value = serde_json::from_str(text).unwrap();
    // `example` wins for `name`; `enum[0]` for status; nested `$ref` resolves.
    assert_eq!(v.get("name").and_then(|n| n.as_str()), Some("doggie"));
    assert_eq!(v.get("status").and_then(|s| s.as_str()), Some("available"));
    assert!(v.pointer("/category/name").is_some());
}

#[test]
fn form_data_with_file_is_multipart() {
    let col = petstore();
    let upload = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "uploads an image")
        .unwrap();
    let Some(ImportedBody::Multipart(fields)) = &upload.body else {
        panic!("expected multipart body, got {:?}", upload.body);
    };
    assert!(fields
        .iter()
        .any(|f| f.name == "additionalMetadata" && !f.is_file));
    assert!(fields.iter().any(|f| f.name == "file" && f.is_file));
    // `petId` is a path param, not a form field.
    assert!(upload.path_params.iter().any(|p| p.name == "petId"));
}

#[test]
fn security_maps_global_and_oauth2_override() {
    let col = petstore();
    // Global `api_key` → ApiKey in header.
    assert!(matches!(
        col.root_auth,
        ImportedAuth::ApiKey {
            in_header: true,
            ..
        }
    ));

    let add = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Add a new pet to the store")
        .unwrap();
    let ImportedAuth::OAuth2 {
        grant, auth_url, ..
    } = &add.auth
    else {
        panic!("expected OAuth2 override, got {:?}", add.auth);
    };
    assert!(matches!(grant, OAuth2GrantKind::Implicit));
    assert_eq!(auth_url, "https://petstore.swagger.io/oauth/authorize");

    // No operation security → inherit the global default.
    let by_id = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Find pet by ID")
        .unwrap();
    assert!(matches!(by_id.auth, ImportedAuth::Inherit));
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
