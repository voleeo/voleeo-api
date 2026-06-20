//! Fixture-driven tests for the Insomnia v4 parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, RawKind,
};

const EXPORT: &str = include_str!("fixtures/insomnia/export.json");

fn sample() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::Insomnia, EXPORT).unwrap()
}

#[test]
fn detects_insomnia() {
    assert_eq!(detect_format(EXPORT), Some(ImportFormat::Insomnia));
}

#[test]
fn maps_name_version_and_base_environment() {
    let col = sample();
    assert_eq!(col.name, "Sample API");
    assert_eq!(col.version.as_deref(), Some("4"));
    let base = col.variables.iter().find(|v| v.key == "base_url").unwrap();
    assert_eq!(base.value, "https://api.example.com");
}

#[test]
fn reconstructs_tree_ordered_by_sort_key() {
    let col = sample();
    // metaSortKey: Users(-100), Upload(-70), GraphQL(-60).
    let names: Vec<String> = col
        .items
        .iter()
        .map(|i| match i {
            ImportedItem::Folder(f) => f.name.clone(),
            ImportedItem::Request(r) => r.name.clone(),
        })
        .collect();
    assert_eq!(names, vec!["Users", "Upload avatar", "GraphQL search"]);

    let users = col
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "Users" => Some(f),
            _ => None,
        })
        .unwrap();
    assert_eq!(users.items.len(), 2);
    // Folder bearer auth; `{{ _.token }}` normalized to `{{ token }}`.
    let ImportedAuth::Bearer { token } = &users.auth else {
        panic!("expected bearer folder auth, got {:?}", users.auth);
    };
    assert_eq!(token, "{{ token }}");
}

#[test]
fn normalizes_template_vars_and_classifies_params() {
    let col = sample();
    let get = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Get user")
        .unwrap();
    assert_eq!(get.url, "{{ base_url }}/users/:id");
    assert!(get.query.iter().any(|p| p.name == "expand" && p.enabled));
    assert!(get.query.iter().any(|p| p.name == "fields" && !p.enabled));
    assert!(get.headers.iter().any(|h| h.name == "Accept"));
    // Empty `authentication: {}` inherits the folder bearer.
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
        panic!("expected raw json, got {:?}", create.body);
    };
    assert!(text.contains("Ada"));

    let upload = reqs.iter().find(|r| r.name == "Upload avatar").unwrap();
    let Some(ImportedBody::Multipart(fields)) = &upload.body else {
        panic!("expected multipart, got {:?}", upload.body);
    };
    assert!(fields.iter().any(|f| f.name == "file" && f.is_file));
    assert!(matches!(upload.auth, ImportedAuth::Basic { .. }));

    let gql = reqs.iter().find(|r| r.name == "GraphQL search").unwrap();
    let Some(ImportedBody::GraphQl { query, .. }) = &gql.body else {
        panic!("expected graphql, got {:?}", gql.body);
    };
    assert!(query.contains("me"));
    // Loose request under the workspace with empty auth → None (no folder to inherit).
    assert!(matches!(gql.auth, ImportedAuth::None));
}

#[test]
fn warns_about_unsupported_tags() {
    // The `{% now %}` tag in a header value should surface a warning.
    let col = sample();
    assert!(col.warnings.iter().any(|w| w.contains("template tags")));
}

#[test]
fn warns_about_filter_and_imports_sub_environment() {
    // A `|` filter inside a tag, plus a second (sub-)environment resource.
    let spec = r#"{"_type":"export","__export_format":4,"resources":[
      {"_id":"wrk_1","_type":"workspace","parentId":null,"name":"X"},
      {"_id":"env_base","_type":"environment","parentId":"wrk_1","data":{"k":"v"}},
      {"_id":"env_sub","_type":"environment","parentId":"env_base","name":"Staging","data":{"k":"v2"}},
      {"_id":"r1","_type":"request","parentId":"wrk_1","name":"R","method":"GET",
       "url":"{{ _.base | upper }}/x","authentication":{}}]}"#;
    let col = parse(ImportFormat::Insomnia, spec).unwrap();
    assert!(col.warnings.iter().any(|w| w.contains("filters")));
    // The sub-environment is imported as its own environment (no warning).
    assert!(col.environments.iter().any(|e| e.name == "Staging"));
    // A plain `|` in a JSON value (not inside a tag) must not trip the filter warning.
    let clean = r#"{"_type":"export","__export_format":4,"resources":[
      {"_id":"w","_type":"workspace","parentId":null,"name":"Y"},
      {"_id":"r","_type":"request","parentId":"w","name":"R","method":"GET",
       "url":"https://x/y","headers":[{"name":"X","value":"a|b"}],"authentication":{}}]}"#;
    let col2 = parse(ImportFormat::Insomnia, clean).unwrap();
    assert!(!col2.warnings.iter().any(|w| w.contains("filters")));
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
