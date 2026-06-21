//! Tests for IR → core conversion, the preview tree, and the selection filter.

use std::collections::HashSet;
use voleeo_import::{
    build_plan, filter_items, parse, preview_nodes, select, ImportFormat, ImportedItem,
};

const PETSTORE: &str = include_str!("fixtures/openapi/petstore.yaml");

#[test]
fn build_plan_wires_folders_and_constants() {
    let col = parse(ImportFormat::OpenApi, PETSTORE).unwrap();
    let plan = build_plan("ws_test", 1000.0, &col);

    assert_eq!(plan.folders.len(), 2);
    assert_eq!(plan.requests.len(), 4);

    // Every request carries the api/http_request constants and an 8-char id.
    for r in &plan.requests {
        assert_eq!(r.request_type, "api");
        assert_eq!(r.model, "http_request");
        assert_eq!(r.workspace_id, "ws_test");
        assert_eq!(r.id.len(), 8);
    }

    // Requests inside a tag folder point at that folder.
    let pets = plan.folders.iter().find(|f| f.name == "pets").unwrap();
    let children = plan
        .requests
        .iter()
        .filter(|r| r.folder_id.as_deref() == Some(pets.id.as_str()))
        .count();
    assert_eq!(children, 3);

    // base_url becomes an imported variable.
    assert!(plan.variables.iter().any(|v| v.key == "base_url"));
    // order seeded from the base.
    assert!(plan.requests.iter().all(|r| r.order >= 1000.0));
}

#[test]
fn preview_ids_match_filter_ids() {
    let col = parse(ImportFormat::OpenApi, PETSTORE).unwrap();
    let nodes = preview_nodes(&col.items);

    // The first folder ("pets") is node "0"; selecting only it + one child keeps them.
    let pets = &nodes[0];
    assert_eq!(pets.id, "0");
    assert_eq!(pets.kind, "folder");
    let first_child = &pets.children[0];
    assert_eq!(first_child.id, "0.0");

    let mut selected = HashSet::new();
    selected.insert(pets.id.clone());
    selected.insert(first_child.id.clone());
    let filtered = filter_items(&col.items, &selected);

    // Only the pets folder survives, with exactly its one selected request.
    assert_eq!(filtered.len(), 1);
    let ImportedItem::Folder(f) = &filtered[0] else {
        panic!("expected folder");
    };
    assert_eq!(f.items.len(), 1);
}

#[test]
fn select_none_keeps_everything() {
    let col = parse(ImportFormat::OpenApi, PETSTORE).unwrap();
    let before = col.items.len();
    let after = select(col, None);
    assert_eq!(after.items.len(), before);
}

#[test]
fn empty_selection_drops_all() {
    let col = parse(ImportFormat::OpenApi, PETSTORE).unwrap();
    let filtered = filter_items(&col.items, &HashSet::new());
    assert!(filtered.is_empty());
}
