//! Fixture-driven tests for the Yaak export (JSON) parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, RawKind,
};

const EXPORT: &str = include_str!("fixtures/yaak/export.json");

fn sample() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::Yaak, EXPORT).unwrap()
}

#[test]
fn detects_yaak() {
    assert_eq!(detect_format(EXPORT), Some(ImportFormat::Yaak));
}

#[test]
fn maps_name_version_base_env_and_root_auth() {
    let col = sample();
    assert_eq!(col.name, "Sample API");
    assert_eq!(col.version.as_deref(), Some("4"));

    let base = col.variables.iter().find(|v| v.key == "base_url").unwrap();
    assert_eq!(base.value, "https://api.example.com");
    // Workspace bearer → root auth; `${[ token ]}` → `{{ token }}`.
    let ImportedAuth::Bearer { token } = &col.root_auth else {
        panic!("expected bearer root auth, got {:?}", col.root_auth);
    };
    assert_eq!(token, "{{ token }}");

    // The sub-environment is imported as its own named environment.
    let sub = col.environments.iter().find(|e| e.name == "Sub").unwrap();
    assert!(sub.variables.iter().any(|v| v.key == "x"));
}

#[test]
fn reconstructs_tree_by_folder_id_ordered_by_sort_priority() {
    let col = sample();
    let names: Vec<String> = col
        .items
        .iter()
        .map(|i| match i {
            ImportedItem::Folder(f) => f.name.clone(),
            ImportedItem::Request(r) => r.name.clone(),
        })
        .collect();
    assert_eq!(names, vec!["Users", "Upload avatar", "GraphQL"]);

    let users = col
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "Users" => Some(f),
            _ => None,
        })
        .unwrap();
    assert_eq!(users.items.len(), 2);
    assert!(matches!(users.auth, ImportedAuth::Inherit));
}

#[test]
fn converts_templates_and_splits_path_query() {
    let col = sample();
    let get = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Get user")
        .unwrap();
    assert_eq!(get.url, "{{ base_url }}/users/:id");
    assert!(get.path_params.iter().any(|p| p.name == "id"));
    assert!(get.query.iter().any(|p| p.name == "expand" && p.enabled));
    assert!(get.query.iter().any(|p| p.name == "fields" && !p.enabled));
    assert!(matches!(get.auth, ImportedAuth::Inherit));
}

#[test]
fn maps_bodies_and_explicit_auth() {
    let col = sample();
    let reqs = all_requests(&col);

    let create = reqs.iter().find(|r| r.name == "Create user").unwrap();
    let Some(ImportedBody::Raw {
        hint: RawKind::Json,
        text,
    }) = &create.body
    else {
        panic!("expected json body, got {:?}", create.body);
    };
    assert!(text.contains("Ada"));

    let upload = reqs.iter().find(|r| r.name == "Upload avatar").unwrap();
    let Some(ImportedBody::Multipart(fields)) = &upload.body else {
        panic!("expected multipart, got {:?}", upload.body);
    };
    assert!(fields.iter().any(|f| f.name == "file" && f.is_file));
    assert!(matches!(upload.auth, ImportedAuth::Basic { .. }));

    let gql = reqs.iter().find(|r| r.name == "GraphQL").unwrap();
    let Some(ImportedBody::GraphQl { query, .. }) = &gql.body else {
        panic!("expected graphql, got {:?}", gql.body);
    };
    assert!(query.contains("me"));
    // Explicit `"none"` → None (not inherit).
    assert!(matches!(gql.auth, ImportedAuth::None));
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
