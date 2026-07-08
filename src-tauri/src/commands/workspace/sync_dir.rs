use super::{derive_sync_dir, resolve_workspace_path};
use crate::commands::request::run_blocking;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;
use voleeo_core::{VoleeoError, Workspace};

/// Absolute path of the workspace's data dir — the symlink target when synced,
/// else the internal app-data path.
#[tauri::command]
#[specta::specta]
pub async fn workspace_get_path(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    voleeo_storage::validate_id(&workspace_id)?;
    Ok(resolve_workspace_path(&state.app_data_dir, &workspace_id)
        .to_string_lossy()
        .into_owned())
}

/// Set (or clear) a workspace's sync directory. Setting one copies the files to
/// the chosen folder and replaces the internal dir with a symlink, so every
/// later write lands in the sync dir transparently.
#[tauri::command]
#[specta::specta]
pub async fn workspace_set_sync_dir(
    state: State<'_, AppState>,
    workspace_id: String,
    sync_dir: Option<String>,
) -> Result<Workspace, VoleeoError> {
    voleeo_storage::validate_id(&workspace_id)?;
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    // Symlink + recursive copy + remove_dir_all all block; keep off the runtime.
    run_blocking(move || {
        let internal_dir = app_data_dir.join("workspaces").join(&workspace_id);

        match &sync_dir {
            Some(new_dir_str) => {
                let new_dir = PathBuf::from(new_dir_str);

                // Copy from the current target if already symlinked, else internal_dir.
                let copy_src = if internal_dir.is_symlink() {
                    crate::platform::read_link_target(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?
                } else {
                    internal_dir.clone()
                };

                // Refuse a folder that already holds another workspace's data —
                // copying into it would clobber it. Re-selecting the current sync
                // dir is a no-op and allowed.
                let same_as_current = match (
                    std::fs::canonicalize(&new_dir),
                    std::fs::canonicalize(&copy_src),
                ) {
                    (Ok(a), Ok(b)) => a == b,
                    _ => false,
                };
                if !same_as_current && dir_has_workspace_data(&new_dir) {
                    return Err(VoleeoError::InvalidConfig(format!(
                        "{} already contains workspace files. Choose an empty folder.",
                        new_dir.display()
                    )));
                }

                copy_workspace_files(&copy_src, &new_dir)?;
                ensure_gitignore(&new_dir)?;

                // Remove the old internal_dir entry (real dir or previous symlink).
                if internal_dir.is_symlink() {
                    crate::platform::remove_link(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
                } else {
                    std::fs::remove_dir_all(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove dir: {e}")))?;
                }

                // Link internal_dir → new_dir; all stores read/write through it.
                crate::platform::link_dir(&new_dir, &internal_dir)
                    .map_err(|e| VoleeoError::Storage(format!("create link: {e}")))?;
            }
            None => {
                // Undo only if a symlink exists: restore a real dir, copy files back.
                if internal_dir.is_symlink() {
                    let target = crate::platform::read_link_target(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?;

                    crate::platform::remove_link(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
                    std::fs::create_dir_all(&internal_dir)
                        .map_err(|e| VoleeoError::Storage(format!("create dir: {e}")))?;
                    copy_workspace_files(&target, &internal_dir)?;
                }
            }
        }

        // sync_dir is machine-local — never persist it; the symlink is the source
        // of truth (re-derived below).
        let mut ws = workspaces.get(&workspace_id)?;
        ws.sync_dir = None; // ensure it never lands in YAML
        ws.updated_at = chrono::Utc::now().to_rfc3339();
        workspaces.save(&ws)?;

        // Re-attach sync dir from the symlink for the UI response.
        ws.sync_dir = derive_sync_dir(&app_data_dir, &workspace_id);
        Ok(ws)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_open_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Workspace, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    // read_to_string + git2 heal + symlink ops all block; keep off the runtime.
    run_blocking(move || register_workspace_folder(&app_data_dir, &PathBuf::from(&folder_path)))
        .await
}

/// Adopt a folder containing a `workspace.yaml` as a workspace: parse it and
/// symlink `workspaces/{id}` → the folder. Shared by Open Folder and Clone.
pub(crate) fn register_workspace_folder(
    app_data_dir: &Path,
    folder: &Path,
) -> Result<Workspace, VoleeoError> {
    let yaml_path = folder.join("workspace.yaml");
    if !yaml_path.exists() {
        return Err(VoleeoError::InvalidConfig(
            "This folder is not a Voleeo workspace (no workspace.yaml)".to_string(),
        ));
    }

    // Recover a mid-merge folder so its workspace.yaml parses (see heal above).
    let _ = voleeo_git::heal_merge_worktree(folder);

    let content = std::fs::read_to_string(&yaml_path)
        .map_err(|e| VoleeoError::Storage(format!("read workspace.yaml: {e}")))?;

    let ws: Workspace = serde_yaml::from_str(&content).map_err(|_| {
        VoleeoError::InvalidConfig(
            "workspace.yaml exists but could not be parsed as a Voleeo workspace.".to_string(),
        )
    })?;

    let internal_dir = app_data_dir.join("workspaces").join(&ws.id);

    if internal_dir.is_symlink() {
        let current_target = crate::platform::read_link_target(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("read symlink: {e}")))?;
        if current_target == folder {
            return Ok(ws);
        }
        crate::platform::remove_link(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("remove symlink: {e}")))?;
    } else if internal_dir.exists() {
        std::fs::remove_dir_all(&internal_dir)
            .map_err(|e| VoleeoError::Storage(format!("remove dir: {e}")))?;
    }

    crate::platform::link_dir(folder, &internal_dir)
        .map_err(|e| VoleeoError::Storage(format!("create link: {e}")))?;

    Ok(ws)
}

/// Ensure `dir/.gitignore` contains the managed entries (currently `.DS_Store`).
pub(crate) fn ensure_gitignore(dir: &Path) -> Result<(), VoleeoError> {
    const ENTRIES: &[&str] = &[".DS_Store"];

    let path = dir.join(".gitignore");

    let existing = if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| VoleeoError::Storage(format!("read .gitignore: {e}")))?
    } else {
        String::new()
    };

    let missing: Vec<&str> = ENTRIES
        .iter()
        .filter(|&&e| !existing.lines().any(|l| l.trim() == e))
        .copied()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };

    let header = if existing.is_empty() {
        "# Voleeo — machine-local files, do not commit\n"
    } else {
        ""
    };

    let append = format!("{separator}{header}{}\n", missing.join("\n"));

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| VoleeoError::Storage(format!("open .gitignore: {e}")))?;

    std::io::Write::write_all(&mut file, append.as_bytes())
        .map_err(|e| VoleeoError::Storage(format!("write .gitignore: {e}")))?;

    Ok(())
}

/// True if `dir` already looks like a Voleeo workspace — a `workspace.yaml` or
/// any per-entity `{req,ws,grpc,folder}_*.yaml`. Used to refuse syncing into a
/// folder whose contents we'd overwrite.
fn dir_has_workspace_data(dir: &Path) -> bool {
    if dir.join("workspace.yaml").exists() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        name.ends_with(".yaml")
            && ["req_", "ws_", "grpc_", "folder_"]
                .iter()
                .any(|p| name.starts_with(p))
    })
}

fn copy_workspace_files(src: &Path, dst: &Path) -> Result<(), VoleeoError> {
    std::fs::create_dir_all(dst)
        .map_err(|e| VoleeoError::Storage(format!("cannot create dir {dst:?}: {e}")))?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| VoleeoError::Storage(format!("cannot read dir {src:?}: {e}")))?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let dst_path = dst.join(entry.file_name());
        std::fs::copy(entry.path(), &dst_path)
            .map_err(|e| VoleeoError::Storage(format!("copy {:?}: {e}", entry.file_name())))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::dir_has_workspace_data;

    #[test]
    fn detects_workspace_data_and_ignores_unrelated() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        assert!(!dir_has_workspace_data(p), "empty dir is fine");

        std::fs::write(p.join("README.md"), "hi").unwrap();
        std::fs::write(p.join("notes.yaml"), "x").unwrap();
        assert!(!dir_has_workspace_data(p), "unrelated files are fine");

        std::fs::write(p.join("req_abc.yaml"), "x").unwrap();
        assert!(
            dir_has_workspace_data(p),
            "per-entity yaml is workspace data"
        );

        std::fs::remove_file(p.join("req_abc.yaml")).unwrap();
        std::fs::write(p.join("workspace.yaml"), "x").unwrap();
        assert!(
            dir_has_workspace_data(p),
            "workspace.yaml is workspace data"
        );
    }
}
