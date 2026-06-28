//! Native Voleeo Bundle import: a complete, self-describing snapshot restored
//! verbatim into fresh workspaces (the reverse of `voleeo-export`). Separate from
//! `import.rs` (foreign formats → IR → one target workspace) because the model is
//! different: bundles recreate whole workspaces, with no cherry-picking target.

use tauri::State;
use voleeo_core::{ApiFolder, VoleeoBundle, VoleeoError, VoleeoWorkspace};
use voleeo_import::{ImportNode, ImportSummary};
use voleeo_storage::{EnvironmentStore, GrpcStore, WsStore};

use crate::commands::request::{run_blocking, Stores};
use crate::state::AppState;

/// Import a native Voleeo Bundle (`voleeoBundle: "1.0"`). Recreates each workspace
/// in the bundle verbatim — folders, HTTP/WS/gRPC requests, environments, and
/// workspace auth/headers/DNS — as a fresh, unencrypted workspace. Bypasses the
/// IR entirely (already core types). Returns the last workspace so the UI can
/// open it.
#[tauri::command]
#[specta::specta]
pub async fn import_voleeo(
    state: State<'_, AppState>,
    content: String,
    workspace_ids: Vec<String>,
) -> Result<ImportSummary, VoleeoError> {
    let stores = Stores::from(&state);
    let environments = state.environments.clone();
    let ws_store = state.ws.clone();
    let grpc_store = state.grpc.clone();

    run_blocking(move || {
        let doc: VoleeoBundle = serde_yaml::from_str(&content)
            .map_err(|e| VoleeoError::Import(format!("not a valid Voleeo Bundle: {e}")))?;
        let want: std::collections::HashSet<String> = workspace_ids.into_iter().collect();
        let selected: Vec<&VoleeoWorkspace> = doc
            .workspaces
            .iter()
            .filter(|vw| want.contains(&vw.workspace.id))
            .collect();
        if selected.is_empty() {
            return Err(VoleeoError::Import(
                "No workspaces selected to import.".into(),
            ));
        }

        let mut last = String::new();
        let mut warnings: Vec<String> = Vec::new();
        let (mut folders_created, mut requests_created, mut variables_created) = (0u32, 0u32, 0u32);

        for vw in selected {
            let created = stores.workspaces.create(vw.workspace.name.clone(), false)?;
            let wid = created.id;
            let result =
                write_voleeo_workspace(&stores, &environments, &ws_store, &grpc_store, &wid, vw);
            match result {
                Ok(counts) => {
                    folders_created += counts.folders;
                    requests_created += counts.requests;
                    variables_created += counts.variables;
                    warnings.extend(counts.warnings);
                    last = wid;
                }
                Err(e) => {
                    let _ = stores.workspaces.delete(&wid);
                    let _ = environments.delete_workspace(&wid);
                    return Err(e);
                }
            }
        }

        Ok(ImportSummary {
            workspace_id: last,
            folders_created,
            requests_created,
            variables_created,
            warnings,
        })
    })
    .await
}

#[derive(Default)]
struct VoleeoCounts {
    folders: u32,
    requests: u32,
    variables: u32,
    warnings: Vec<String>,
}

fn write_voleeo_workspace(
    stores: &Stores,
    environments: &EnvironmentStore,
    ws_store: &WsStore,
    grpc_store: &GrpcStore,
    wid: &str,
    vw: &VoleeoWorkspace,
) -> Result<VoleeoCounts, VoleeoError> {
    let mut workspace = vw.workspace.clone();
    workspace.id = wid.to_string();
    workspace.encrypted = false;
    workspace.sync_dir = None;
    workspace.key_check = None;
    workspace.auth.mark_secrets_plaintext();
    stores.workspaces.save(&workspace)?;

    let folder_ids: std::collections::HashSet<&str> =
        vw.folders.iter().map(|f| f.id.as_str()).collect();
    let mut dangling = 0u32;
    let mut reparent = |fid: &mut Option<String>| {
        if let Some(id) = fid.as_ref() {
            if !folder_ids.contains(id.as_str()) {
                dangling += 1;
                *fid = None;
            }
        }
    };

    let mut folders = vw.folders.clone();
    let mut requests = vw.requests.clone();
    for f in &mut folders {
        f.workspace_id = wid.to_string();
        reparent(&mut f.folder_id);
        f.auth.mark_secrets_plaintext();
        for v in &mut f.variables {
            v.encrypted = false;
        }
    }
    for r in &mut requests {
        r.workspace_id = wid.to_string();
        reparent(&mut r.folder_id);
        r.auth.mark_secrets_plaintext();
    }
    stores.requests.write_bulk(&folders, &requests)?;

    for w in &vw.websockets {
        let mut w = w.clone();
        w.workspace_id = wid.to_string();
        reparent(&mut w.folder_id);
        w.auth.mark_secrets_plaintext();
        ws_store.save(&w)?;
    }
    for g in &vw.grpc {
        let mut g = g.clone();
        g.workspace_id = wid.to_string();
        reparent(&mut g.folder_id);
        g.auth.mark_secrets_plaintext();
        grpc_store.save(&g)?;
    }

    let mut variables = 0u32;
    for env in &vw.environments {
        let mut env = env.clone();
        env.workspace_id = wid.to_string();
        for v in &mut env.variables {
            v.encrypted = false;
        }
        variables += env.variables.len() as u32;
        environments.save(&env)?;
    }

    let mut warnings = Vec::new();
    if dangling > 0 {
        warnings.push(format!(
            "{dangling} item(s) referenced a missing folder and were placed at the workspace root."
        ));
    }
    Ok(VoleeoCounts {
        folders: folders.len() as u32,
        requests: requests.len() as u32,
        variables,
        warnings,
    })
}

/// Read-only summary of a bundle for the import confirm screen — what each
/// workspace would restore — without writing anything.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VoleeoBundlePreview {
    pub workspaces: Vec<BundleWorkspacePreview>,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleWorkspacePreview {
    /// The bundle's own workspace id — the selection key passed back to
    /// `import_voleeo` (a fresh id is minted on import).
    pub id: String,
    pub name: String,
    pub encrypted: bool,
    pub request_count: u32,
    pub environment_count: u32,
    /// Folder/request tree in the shared `ImportNode` shape the import tree renders.
    pub tree: Vec<ImportNode>,
}

#[tauri::command]
#[specta::specta]
pub async fn import_voleeo_preview(content: String) -> Result<VoleeoBundlePreview, VoleeoError> {
    run_blocking(move || {
        let doc: VoleeoBundle = serde_yaml::from_str(&content)
            .map_err(|e| VoleeoError::Import(format!("not a valid Voleeo Bundle: {e}")))?;
        Ok(VoleeoBundlePreview {
            workspaces: doc.workspaces.iter().map(preview_workspace).collect(),
        })
    })
    .await
}

fn preview_workspace(vw: &VoleeoWorkspace) -> BundleWorkspacePreview {
    BundleWorkspacePreview {
        id: vw.workspace.id.clone(),
        name: vw.workspace.name.clone(),
        encrypted: vw.workspace.encrypted,
        request_count: (vw.requests.len() + vw.websockets.len() + vw.grpc.len()) as u32,
        environment_count: vw.environments.len() as u32,
        tree: bundle_tree(vw),
    }
}

/// Rebuild the folder/request tree (nesting by `folder_id`, ordered by `order`).
fn bundle_tree(vw: &VoleeoWorkspace) -> Vec<ImportNode> {
    use std::collections::HashMap;
    let mut leaves: HashMap<Option<String>, Vec<(f64, ImportNode)>> = HashMap::new();
    let mut leaf =
        |fid: Option<String>, order: f64, id: String, name: String, method: &str, path: String| {
            leaves.entry(fid).or_default().push((
                order,
                ImportNode {
                    id,
                    kind: "request".into(),
                    name,
                    method: Some(method.into()),
                    path: Some(path),
                    description: None,
                    children: Vec::new(),
                },
            ));
        };
    for r in &vw.requests {
        leaf(
            r.folder_id.clone(),
            r.order,
            r.id.clone(),
            r.name.clone(),
            &r.method,
            r.url.clone(),
        );
    }
    for w in &vw.websockets {
        leaf(
            w.folder_id.clone(),
            w.order,
            w.id.clone(),
            w.name.clone(),
            "WS",
            w.url.clone(),
        );
    }
    for g in &vw.grpc {
        let path = g
            .service
            .clone()
            .map_or(String::new(), |s| match &g.method {
                Some(m) => format!("{s}/{m}"),
                None => s,
            });
        leaf(
            g.folder_id.clone(),
            g.order,
            g.id.clone(),
            g.name.clone(),
            "GRPC",
            path,
        );
    }
    folder_nodes(None, &vw.folders, &mut leaves)
}

fn folder_nodes(
    parent: Option<&str>,
    folders: &[ApiFolder],
    leaves: &mut std::collections::HashMap<Option<String>, Vec<(f64, ImportNode)>>,
) -> Vec<ImportNode> {
    let mut out: Vec<(f64, ImportNode)> = folders
        .iter()
        .filter(|f| f.folder_id.as_deref() == parent)
        .map(|f| {
            (
                f.order,
                ImportNode {
                    id: f.id.clone(),
                    kind: "folder".into(),
                    name: f.name.clone(),
                    method: None,
                    path: None,
                    description: None,
                    children: folder_nodes(Some(&f.id), folders, leaves),
                },
            )
        })
        .collect();
    out.extend(
        leaves
            .remove(&parent.map(str::to_string))
            .unwrap_or_default(),
    );
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out.into_iter().map(|(_, n)| n).collect()
}
