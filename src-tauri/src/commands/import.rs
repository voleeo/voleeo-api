use crate::commands::request::{
    run_blocking, transform_auth_secrets, transform_var_secrets, Direction, Stores,
};
use crate::state::AppState;
use tauri::State;
use voleeo_core::{AuthConfig, EnvironmentVariable, VoleeoError};
use voleeo_crypto as workspace_key;
use voleeo_import::{
    build_plan, detect_format, parse, select, ImportDest, ImportFormat, ImportPreview,
    ImportSummary, ImportedAuth,
};

fn import_err(e: voleeo_import::ImportError) -> VoleeoError {
    VoleeoError::Import(e.to_string())
}

/// Parse (auto-detecting the format when not given) and return the preview tree.
#[tauri::command]
#[specta::specta]
pub async fn import_preview(
    format: Option<ImportFormat>,
    content: String,
) -> Result<ImportPreview, VoleeoError> {
    run_blocking(move || {
        let fmt = match format {
            Some(f) => f,
            None => detect_format(&content).ok_or_else(|| {
                VoleeoError::Import(
                    "Could not detect the collection format — pick one manually.".into(),
                )
            })?,
        };
        voleeo_import::preview(fmt, &content).map_err(import_err)
    })
    .await
}

/// Read a user-picked collection file's text (dialog returns a path; there's no
/// fs plugin on the JS side). Off-runtime — `std::fs` blocks.
#[tauri::command]
#[specta::specta]
pub async fn import_read_file(path: String) -> Result<String, VoleeoError> {
    run_blocking(move || {
        std::fs::read_to_string(&path).map_err(|e| VoleeoError::Storage(e.to_string()))
    })
    .await
}

/// Fetch a remote spec by URL so the UI can import an OpenAPI/Swagger document
/// straight from a link. Returns the raw text for `import_preview`.
#[tauri::command]
#[specta::specta]
pub async fn import_fetch_url(url: String) -> Result<String, VoleeoError> {
    // Build a client per fetch (rare, user-triggered) so we can set a User-Agent —
    // WAF-fronted hosts (e.g. the Swagger demo) 404 when the UA header is absent.
    let client = reqwest::Client::builder()
        .user_agent("Voleeo")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| VoleeoError::Http(e.to_string()))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| VoleeoError::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(VoleeoError::Http(format!(
            "fetch failed: HTTP {}",
            resp.status()
        )));
    }
    resp.text()
        .await
        .map_err(|e| VoleeoError::Http(e.to_string()))
}

/// Parse, filter by `selected`, and persist into the target workspace.
#[tauri::command]
#[specta::specta]
pub async fn import_commit(
    state: State<'_, AppState>,
    format: ImportFormat,
    content: String,
    dest: ImportDest,
    selected: Option<Vec<String>>,
) -> Result<ImportSummary, VoleeoError> {
    let stores = Stores::from(&state);
    let environments = state.environments.clone();
    let app_data_dir = state.app_data_dir.clone();

    run_blocking(move || {
        let col = parse(format, &content).map_err(import_err)?;
        let had_root_auth = !matches!(col.root_auth, ImportedAuth::None);
        let col = select(col, selected.as_deref());

        // Resolve the target workspace, its encryption flag, and the order base.
        let (workspace_id, encrypted, parent_folder, apply_root_auth) = match &dest {
            ImportDest::NewWorkspace { name, encrypted } => {
                let ws = stores.workspaces.create(name.clone(), *encrypted)?;
                if *encrypted {
                    let key = workspace_key::generate_key();
                    workspace_key::save_key(&ws.id, &key, &app_data_dir)?;
                }
                (ws.id, *encrypted, None, true)
            }
            ImportDest::ExistingWorkspace {
                workspace_id,
                parent_folder_id,
            } => {
                let ws = stores.workspaces.get(workspace_id)?;
                (
                    workspace_id.clone(),
                    ws.encrypted,
                    parent_folder_id.clone(),
                    false,
                )
            }
        };

        let order_base = next_order_base(&stores, &dest, &workspace_id)?;
        let mut plan = build_plan(&workspace_id, order_base, &col);

        // Existing target: re-parent root nodes under the chosen folder.
        if let Some(parent) = &parent_folder {
            for f in plan.folders.iter_mut().filter(|f| f.folder_id.is_none()) {
                f.folder_id = Some(parent.clone());
            }
            for r in plan.requests.iter_mut().filter(|r| r.folder_id.is_none()) {
                r.folder_id = Some(parent.clone());
            }
        }

        // Encrypt auth secrets at rest on encrypted workspaces (mirrors create_request).
        if encrypted {
            for f in plan.folders.iter_mut() {
                encrypt_auth(&mut f.auth, &workspace_id, &stores)?;
            }
            for r in plan.requests.iter_mut() {
                encrypt_auth(&mut r.auth, &workspace_id, &stores)?;
            }
            for v in plan.variables.iter_mut().filter(|v| v.encrypted) {
                transform_var_secrets(
                    std::slice::from_mut(v),
                    &workspace_id,
                    &stores,
                    Direction::Encrypt,
                )?;
            }
        }

        stores.requests.write_bulk(&plan.folders, &plan.requests)?;

        // Collection-level auth: applied to a new workspace, never overwritten on
        // an existing one (would silently change the user's setup).
        if apply_root_auth && !matches!(plan.root_auth, AuthConfig::None) {
            if encrypted {
                encrypt_auth(&mut plan.root_auth, &workspace_id, &stores)?;
            }
            stores
                .workspaces
                .update_auth(&workspace_id, plan.root_auth.clone())?;
        }
        if had_root_auth && !apply_root_auth {
            plan.warnings.push(
                "The collection defined collection-level auth; it was not applied to the \
                 existing workspace. Set it on the workspace or a folder if needed."
                    .into(),
            );
        }

        // Imported variables go into the workspace's Global environment, keeping
        // any existing value on a key clash.
        let mut env = environments.ensure_global(&workspace_id)?;
        let existing: std::collections::HashSet<String> =
            env.variables.iter().map(|v| v.key.clone()).collect();
        let added: Vec<_> = plan
            .variables
            .iter()
            .filter(|v| !existing.contains(&v.key))
            .cloned()
            .collect();
        let mut variables_created = added.len() as u32;
        if !added.is_empty() {
            env.variables.extend(added);
            environments.save(&env)?;
        }

        // Named sub-environments → one Voleeo environment each (never colorless).
        for ie in col.environments.iter().filter(|e| !e.variables.is_empty()) {
            let mut new_env = environments.create_personal(
                workspace_id.clone(),
                ie.name.clone(),
                random_env_color(),
                false,
            )?;
            new_env.variables = ie
                .variables
                .iter()
                .map(|v| EnvironmentVariable {
                    key: v.key.clone(),
                    value: v.value.clone(),
                    encrypted: false,
                    enabled: true,
                })
                .collect();
            variables_created += new_env.variables.len() as u32;
            environments.save(&new_env)?;
        }

        Ok(ImportSummary {
            workspace_id,
            folders_created: plan.folders.len() as u32,
            requests_created: plan.requests.len() as u32,
            variables_created,
            warnings: plan.warnings,
        })
    })
    .await
}

/// New workspaces seed `order` from the wall clock; existing ones append past
/// the highest current sibling so imports never collide with what's there.
fn next_order_base(
    stores: &Stores,
    dest: &ImportDest,
    workspace_id: &str,
) -> Result<f64, VoleeoError> {
    match dest {
        ImportDest::NewWorkspace { .. } => Ok(chrono::Utc::now().timestamp_millis() as f64),
        ImportDest::ExistingWorkspace { .. } => {
            let mut max = 0f64;
            for r in stores.requests.list_requests(workspace_id)? {
                max = max.max(r.order);
            }
            for f in stores.requests.list_folders(workspace_id)? {
                max = max.max(f.order);
            }
            Ok(max + 1.0)
        }
    }
}

/// A random theme accent slot for a new environment — imported envs are never
/// colorless. Slots are `var(--baseXX)` refs so they track the active theme.
fn random_env_color() -> String {
    use rand::RngExt;
    const SLOTS: [&str; 8] = [
        "--base08", "--base09", "--base0A", "--base0B", "--base0C", "--base0D", "--base0E",
        "--base0F",
    ];
    format!("var({})", SLOTS[rand::rng().random_range(0..SLOTS.len())])
}

/// Flag the auth's secret fields encrypted then encrypt them with the workspace
/// key. No-op for `None`/`Inherit` (no secret fields).
fn encrypt_auth(
    auth: &mut AuthConfig,
    workspace_id: &str,
    stores: &Stores,
) -> Result<(), VoleeoError> {
    auth.mark_secrets_encrypted();
    transform_auth_secrets(auth, workspace_id, stores, Direction::Encrypt)
}
