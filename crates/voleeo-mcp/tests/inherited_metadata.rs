//! Parity fixture for header inheritance. `merge_inherited_metadata` (send
//! path) and the frontend's `mergeInheritedMetadata` (copy-as-grpcurl) must
//! agree, or a copied command stops reproducing the request it came from.
//! `src-web/src/lib/mergeInheritedMetadata.test.ts` reads this same file — add
//! cases here and both suites pick them up.

use serde::Deserialize;
use voleeo_core::{ApiFolder, AuthConfig, RequestParameter};
use voleeo_mcp::resolve::merge_inherited_metadata;

#[derive(Deserialize)]
struct Case {
    name: String,
    own: Vec<Param>,
    folders: Vec<Folder>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
    #[serde(rename = "workspaceHeaders")]
    workspace_headers: Vec<Param>,
    expected: Vec<Expected>,
}

#[derive(Deserialize)]
struct Param {
    name: String,
    value: String,
    enabled: bool,
}

#[derive(Deserialize)]
struct Folder {
    id: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    headers: Vec<Param>,
}

#[derive(Deserialize)]
struct Expected {
    name: String,
    value: String,
}

fn params(rows: &[Param]) -> Vec<RequestParameter> {
    rows.iter()
        .enumerate()
        .map(|(i, p)| RequestParameter {
            id: format!("p{i}"),
            name: p.name.clone(),
            value: p.value.clone(),
            enabled: p.enabled,
        })
        .collect()
}

fn folder(f: &Folder) -> ApiFolder {
    ApiFolder {
        id: f.id.clone(),
        folder_type: "folder".into(),
        model: "folder".into(),
        workspace_id: "w1".into(),
        folder_id: f.parent_id.clone(),
        name: f.id.clone(),
        headers: params(&f.headers),
        auth: AuthConfig::None,
        variables: Vec::new(),
        color: None,
        order: 0.0,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn matches_shared_fixture() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("fixtures/inherited_metadata/cases.json")).unwrap();

    for case in &cases {
        let folders: Vec<ApiFolder> = case.folders.iter().map(folder).collect();
        let got = merge_inherited_metadata(
            &params(&case.own),
            case.folder_id.as_deref(),
            &folders,
            &params(&case.workspace_headers),
        );

        let got: Vec<(&str, &str)> = got
            .iter()
            .map(|p| (p.name.as_str(), p.value.as_str()))
            .collect();
        let want: Vec<(&str, &str)> = case
            .expected
            .iter()
            .map(|e| (e.name.as_str(), e.value.as_str()))
            .collect();

        assert_eq!(got, want, "case: {}", case.name);
    }
}
