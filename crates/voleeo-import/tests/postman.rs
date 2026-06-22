//! Fixture-driven tests for the Postman v2.1 parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, RawKind,
};

const SAMPLE: &str = include_str!("fixtures/postman/sample.postman_collection.json");

fn sample() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::Postman, SAMPLE).unwrap()
}

#[test]
fn detects_postman() {
    assert_eq!(detect_format(SAMPLE), Some(ImportFormat::Postman));
}

#[test]
fn maps_name_version_variables_and_root_auth() {
    let col = sample();
    assert_eq!(col.name, "Sample API");
    assert_eq!(col.version.as_deref(), Some("2.1"));
    let base = col.variables.iter().find(|v| v.key == "base_url").unwrap();
    assert_eq!(base.value, "https://api.example.com");
    // Collection-level bearer → root auth; the `{{token}}` ref passes through.
    let ImportedAuth::Bearer { token } = &col.root_auth else {
        panic!("expected bearer root auth, got {:?}", col.root_auth);
    };
    assert_eq!(token, "{{token}}");
}

#[test]
fn nests_folders_arbitrary_depth() {
    let col = sample();
    // Top level: folder "Users" + two loose requests.
    let folders: Vec<&str> = col
        .items
        .iter()
        .filter_map(|i| match i {
            ImportedItem::Folder(f) => Some(f.name.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(folders, vec!["Users"]);

    let users = col
        .items
        .iter()
        .find_map(|i| match i {
            ImportedItem::Folder(f) if f.name == "Users" => Some(f),
            _ => None,
        })
        .unwrap();
    assert_eq!(users.items.len(), 2);
    // No explicit folder auth → inherit.
    assert!(matches!(users.auth, ImportedAuth::Inherit));
}

#[test]
fn parses_object_url_query_path_vars_and_headers() {
    let col = sample();
    let get = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Get user")
        .unwrap();
    // Query stripped from the stored URL; `:id` template preserved.
    assert_eq!(get.url, "{{base_url}}/users/:id");
    assert!(get.query.iter().any(|p| p.name == "expand" && p.enabled));
    assert!(get.query.iter().any(|p| p.name == "fields" && !p.enabled));
    assert!(get.path_params.iter().any(|p| p.name == "id"));
    assert!(get.headers.iter().any(|h| h.name == "Accept" && h.enabled));
    assert!(get
        .headers
        .iter()
        .any(|h| h.name == "X-Debug" && !h.enabled));
    // No own auth → inherits the collection bearer.
    assert!(matches!(get.auth, ImportedAuth::Inherit));
}

#[test]
fn maps_raw_graphql_and_formdata_bodies() {
    let col = sample();
    let reqs = all_requests(&col);

    let create = reqs.iter().find(|r| r.name == "Create user").unwrap();
    let Some(ImportedBody::Raw {
        hint: RawKind::Json,
        text,
    }) = &create.body
    else {
        panic!("expected raw json body, got {:?}", create.body);
    };
    assert!(text.contains("Ada"));

    let upload = reqs.iter().find(|r| r.name == "Upload avatar").unwrap();
    let Some(ImportedBody::Multipart(fields)) = &upload.body else {
        panic!("expected multipart, got {:?}", upload.body);
    };
    assert!(fields.iter().any(|f| f.name == "file" && f.is_file));
    assert!(fields.iter().any(|f| f.name == "caption" && !f.is_file));
    // Explicit basic auth overrides the collection bearer.
    assert!(matches!(upload.auth, ImportedAuth::Basic { .. }));

    let gql = reqs.iter().find(|r| r.name == "GraphQL search").unwrap();
    let Some(ImportedBody::GraphQl { query, .. }) = &gql.body else {
        panic!("expected graphql, got {:?}", gql.body);
    };
    assert!(query.contains("me"));
}

#[test]
fn reconstructs_url_from_host_path_when_raw_absent() {
    // Some exports omit `url.raw` and carry only host/path arrays.
    let spec = r#"{"info":{"name":"x","schema":"v2.1.0"},"item":[
      {"name":"r","request":{"method":"GET","url":{
        "host":["{{base_url}}"],"path":["users",":id"]}}}]}"#;
    let col = parse(ImportFormat::Postman, spec).unwrap();
    let r = all_requests(&col).into_iter().next().unwrap();
    assert_eq!(r.url, "{{base_url}}/users/:id");
}

#[test]
fn warns_about_uniported_scripts() {
    let col = sample();
    assert!(col.warnings.iter().any(|w| w.contains("script")));
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
