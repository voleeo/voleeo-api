//! Fixture-driven tests for the Bruno OpenCollection (YAML) parser → IR mapping.

use voleeo_import::{
    detect_format, parse, ImportFormat, ImportedAuth, ImportedBody, ImportedItem, OAuth2GrantKind,
    RawKind,
};

const COLLECTION: &str = include_str!("fixtures/bruno/collection.yml");

fn sample() -> voleeo_import::ImportedCollection {
    parse(ImportFormat::Bruno, COLLECTION).unwrap()
}

#[test]
fn detects_bruno() {
    assert_eq!(detect_format(COLLECTION), Some(ImportFormat::Bruno));
}

#[test]
fn maps_name_version_variables_and_root_auth() {
    let col = sample();
    assert_eq!(col.name, "Sample API");
    assert_eq!(col.version.as_deref(), Some("1.0.0"));

    // Collection-level typed var → Global; unwraps to its `data`.
    assert_eq!(
        col.variables
            .iter()
            .find(|v| v.key == "coll_num")
            .unwrap()
            .value,
        "100"
    );

    // Each `config.environments` entry becomes its own environment.
    let env_names: Vec<&str> = col.environments.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(env_names, vec!["dev", "prod"]);
    let dev = col.environments.iter().find(|e| e.name == "dev").unwrap();
    assert_eq!(
        dev.variables
            .iter()
            .find(|v| v.key == "base_url")
            .unwrap()
            .value,
        "https://api.example.com"
    );
    // Secret variable exports no value.
    assert_eq!(
        dev.variables
            .iter()
            .find(|v| v.key == "token")
            .unwrap()
            .value,
        ""
    );

    let ImportedAuth::Bearer { token } = &col.root_auth else {
        panic!("expected bearer root auth, got {:?}", col.root_auth);
    };
    assert_eq!(token, "{{ token }}");
}

#[test]
fn nests_items_ordered_by_seq() {
    let col = sample();
    let names: Vec<String> = col
        .items
        .iter()
        .map(|i| match i {
            ImportedItem::Folder(f) => f.name.clone(),
            ImportedItem::Request(r) => r.name.clone(),
        })
        .collect();
    assert_eq!(names, vec!["Users", "Upload avatar"]);

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
fn splits_path_and_query_params() {
    let col = sample();
    let get = all_requests(&col)
        .into_iter()
        .find(|r| r.name == "Get user")
        .unwrap();
    assert_eq!(get.url, "{{base_url}}/users/:id");
    assert!(get.path_params.iter().any(|p| p.name == "id"));
    assert!(get.query.iter().any(|p| p.name == "expand" && p.enabled));
    assert!(get.query.iter().any(|p| p.name == "fields" && !p.enabled));
    assert!(get
        .headers
        .iter()
        .any(|h| h.name == "X-Debug" && !h.enabled));
    assert!(matches!(get.auth, ImportedAuth::Inherit));
}

#[test]
fn maps_bodies_and_oauth2() {
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
    assert!(fields.iter().any(|f| f.name == "caption" && !f.is_file));
    let ImportedAuth::OAuth2 {
        grant, token_url, ..
    } = &upload.auth
    else {
        panic!("expected oauth2, got {:?}", upload.auth);
    };
    assert!(matches!(grant, OAuth2GrantKind::AuthorizationCode));
    assert_eq!(token_url, "https://auth.example.com/token");
}

#[test]
fn warns_about_scripts() {
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
