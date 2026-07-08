//! Workspace commands, split by concern: CRUD (`crud`), key/encryption
//! (`encryption`), sync-dir/symlink plumbing (`sync_dir`), and per-workspace UI
//! settings (`settings`). Shared path helpers live here so both the commands and
//! the `git` module resolve them at `crate::commands::workspace::…`.

pub mod crud;
pub mod encryption;
pub mod settings;
pub mod sync_dir;

use std::path::{Path, PathBuf};

// Glob re-exports keep `commands::workspace::<cmd>` resolving for lib.rs. The
// `#[tauri::command]` macro emits a sibling `__cmd__<name>` item that
// `generate_handler!` needs; a glob carries it, a per-name `use` would not.
// `sync_dir`'s glob also re-exports `ensure_gitignore` + `register_workspace_folder`
// (crate-visible) for the git module.
pub use crud::*;
pub use encryption::*;
pub use settings::*;
pub use sync_dir::*;

/// Sync dir = the symlink target when `workspaces/{id}` is a symlink, else
/// `None` (normal internal storage).
pub(crate) fn derive_sync_dir(app_data_dir: &Path, workspace_id: &str) -> Option<String> {
    let internal = app_data_dir.join("workspaces").join(workspace_id);
    if internal.is_symlink() {
        crate::platform::read_link_target(&internal)
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Resolved on-disk dir of a workspace: the symlink target when synced, else the
/// internal app-data path. Shared by `workspace_get_path` and the git commands.
pub(crate) fn resolve_workspace_path(app_data_dir: &Path, workspace_id: &str) -> PathBuf {
    let internal = app_data_dir.join("workspaces").join(workspace_id);
    if internal.is_symlink() {
        crate::platform::read_link_target(&internal).unwrap_or(internal)
    } else {
        internal
    }
}
