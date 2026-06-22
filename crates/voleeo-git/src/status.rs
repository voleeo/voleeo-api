use crate::{classify_path, git_err, open_repo};
use git2::{Repository, Status, StatusOptions};
use std::path::Path;
use voleeo_core::{GitChange, GitFileChange, GitStatus, VoleeoError};

/// YAML keys whose churn shouldn't count as a git change. Editing then reverting
/// a request still bumps `updatedAt`, leaving a spurious timestamp-only diff.
const VOLATILE_KEYS: &[&str] = &["updatedAt:"];

pub fn status(path: &Path) -> Result<GitStatus, VoleeoError> {
    let repo = open_repo(path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git_err)?;

    let mut files = Vec::new();
    let mut conflicted = false;
    for entry in statuses.iter() {
        let st = entry.status();
        let Ok(p) = entry.path().map(String::from) else {
            continue;
        };
        // `.gitignore` is app-managed infrastructure, committed automatically with
        // every commit — never a user-facing change. Hiding it keeps the dirty
        // indicator honest: the entity review can't show it, so counting it would
        // leave the branch "dirty" against an empty changes list.
        if p == ".gitignore" {
            continue;
        }
        // Hide files whose only change vs HEAD is volatile metadata (timestamps).
        if !st.contains(Status::CONFLICTED) && only_volatile_change(&repo, &p) {
            continue;
        }
        let (node_kind, node_id) = classify_path(&p);

        if st.contains(Status::CONFLICTED) {
            conflicted = true;
            files.push(GitFileChange {
                path: p,
                node_id,
                node_kind,
                change: GitChange::Conflicted,
                staged: false,
            });
            continue;
        }
        if let Some(change) = index_change(st) {
            files.push(GitFileChange {
                path: p.clone(),
                node_id: node_id.clone(),
                node_kind,
                change,
                staged: true,
            });
        }
        if let Some(change) = worktree_change(st) {
            files.push(GitFileChange {
                path: p,
                node_id,
                node_kind,
                change,
                staged: false,
            });
        }
    }
    Ok(GitStatus { files, conflicted })
}

/// Reset every working file whose only change vs HEAD is volatile metadata
/// (timestamps) back to its HEAD content. The UI already treats these as "no
/// change"; clearing them before a pull stops `updatedAt` churn from blocking the
/// merge with a phantom "uncommitted changes" the user can't see or commit.
pub fn discard_volatile_changes(path: &Path) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
        return Ok(());
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git_err)?;
    for entry in statuses.iter() {
        if entry.status().contains(Status::CONFLICTED) {
            continue;
        }
        let Ok(rel) = entry.path() else { continue };
        if !only_volatile_change(&repo, rel) {
            continue;
        }
        let head_blob = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok())
            .and_then(|t| t.get_path(Path::new(rel)).ok())
            .and_then(|e| repo.find_blob(e.id()).ok());
        if let Some(blob) = head_blob {
            std::fs::write(workdir.join(rel), blob.content())
                .map_err(|e| VoleeoError::Git(format!("Failed to reset {rel}: {e}")))?;
        }
    }
    Ok(())
}

fn strip_volatile(content: &str) -> String {
    content
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            !VOLATILE_KEYS.iter().any(|k| t.starts_with(k))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// True when the working file and its HEAD version are identical once volatile
/// lines are removed — i.e. the file changed only in `updatedAt`.
pub(crate) fn only_volatile_change(repo: &Repository, rel: &str) -> bool {
    let Some(workdir) = repo.workdir() else {
        return false;
    };
    let Ok(working) = std::fs::read_to_string(workdir.join(rel)) else {
        return false;
    };
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok())
        .and_then(|t| t.get_path(Path::new(rel)).ok())
        .and_then(|e| repo.find_blob(e.id()).ok());
    let Some(blob) = head else {
        return false;
    };
    let Ok(head_content) = std::str::from_utf8(blob.content()) else {
        return false;
    };
    working != head_content && strip_volatile(&working) == strip_volatile(head_content)
}

fn index_change(st: Status) -> Option<GitChange> {
    if st.contains(Status::INDEX_NEW) {
        Some(GitChange::Added)
    } else if st.contains(Status::INDEX_DELETED) {
        Some(GitChange::Deleted)
    } else if st.contains(Status::INDEX_RENAMED) {
        Some(GitChange::Renamed)
    } else if st.intersects(Status::INDEX_MODIFIED | Status::INDEX_TYPECHANGE) {
        Some(GitChange::Modified)
    } else {
        None
    }
}

fn worktree_change(st: Status) -> Option<GitChange> {
    if st.contains(Status::WT_NEW) {
        Some(GitChange::Untracked)
    } else if st.contains(Status::WT_DELETED) {
        Some(GitChange::Deleted)
    } else if st.contains(Status::WT_RENAMED) {
        Some(GitChange::Renamed)
    } else if st.intersects(Status::WT_MODIFIED | Status::WT_TYPECHANGE) {
        Some(GitChange::Modified)
    } else {
        None
    }
}
