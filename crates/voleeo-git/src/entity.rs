use crate::status::status;
use crate::{classify_path, git_err, open_repo};
use git2::{DiffFormat, DiffOptions, Oid, Repository};
use std::collections::BTreeSet;
use std::path::Path;
use voleeo_core::{GitChange, GitNodeKind, VoleeoError};

/// One changed file's HEAD + working text, for the entity-level "Review changes"
/// screen. The command layer parses + decrypts `head`/`work` into typed entities.
pub struct ChangedBlob {
    pub path: String,
    pub node_id: Option<String>,
    pub node_kind: GitNodeKind,
    /// Entity-level status: Added (no HEAD), Deleted (no working file), else Modified.
    pub change: GitChange,
    pub head: Option<String>,
    pub work: Option<String>,
}

/// Collect the HEAD and working text of every changed file. Reuses `status()`
/// (so timestamp-only churn is already filtered) and ignores conflicted files —
/// those belong to the Resolve-conflicts flow.
pub fn changed_blobs(path: &Path) -> Result<Vec<ChangedBlob>, VoleeoError> {
    let repo = open_repo(path)?;
    // status() can list a path twice (staged + worktree); dedupe to one entity row.
    let paths: BTreeSet<String> = status(path)?
        .files
        .into_iter()
        .filter(|f| f.change != GitChange::Conflicted)
        .map(|f| f.path)
        .collect();

    let mut out = Vec::new();
    for p in paths {
        let head = head_text(&repo, &p);
        let work = std::fs::read_to_string(path.join(&p)).ok();
        let change = match (&head, &work) {
            (None, _) => GitChange::Added,
            (Some(_), None) => GitChange::Deleted,
            _ => GitChange::Modified,
        };
        let (node_kind, node_id) = classify_path(&p);
        out.push(ChangedBlob {
            path: p,
            node_id,
            node_kind,
            change,
            head,
            work,
        });
    }
    Ok(out)
}

/// What a single commit changed vs its first parent (the initial commit diffs
/// against the empty tree). `head` is the parent side, `work` the commit side —
/// so the command layer can reuse the same parse+decrypt path as `changed_blobs`.
pub fn commit_blobs(path: &Path, commit_id: &str) -> Result<Vec<ChangedBlob>, VoleeoError> {
    let repo = open_repo(path)?;
    let oid = Oid::from_str(commit_id).map_err(git_err)?;
    let commit = repo.find_commit(oid).map_err(git_err)?;
    let new_tree = commit.tree().map_err(git_err)?;
    let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)
        .map_err(git_err)?;

    let mut out = Vec::new();
    for delta in diff.deltas() {
        let p = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str());
        let Some(p) = p else { continue };
        let head = blob_text(&repo, delta.old_file().id());
        let work = blob_text(&repo, delta.new_file().id());
        let change = match (&head, &work) {
            (None, _) => GitChange::Added,
            (Some(_), None) => GitChange::Deleted,
            _ => GitChange::Modified,
        };
        let (node_kind, node_id) = classify_path(p);
        out.push(ChangedBlob {
            path: p.to_string(),
            node_id,
            node_kind,
            change,
            head,
            work,
        });
    }
    Ok(out)
}

/// Undo a commit by writing the *pre-commit* (parent-side) content of its files
/// back into the working tree — left unstaged so the user reviews them as
/// pending changes and publishes. `only` scopes the revert to one file (per-file
/// history); `None` reverts every file the commit touched. Raw blob bytes are
/// written verbatim, so encrypted-workspace ciphertext round-trips untouched.
pub fn revert_commit_files(
    path: &Path,
    commit_id: &str,
    only: Option<&str>,
) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let oid = Oid::from_str(commit_id).map_err(git_err)?;
    let commit = repo.find_commit(oid).map_err(git_err)?;
    let new_tree = commit.tree().map_err(git_err)?;
    let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)
        .map_err(git_err)?;

    for delta in diff.deltas() {
        let Some(p) = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
        else {
            continue;
        };
        if only.is_some_and(|o| o != p) {
            continue;
        }
        let full = path.join(p);
        let old_id = delta.old_file().id();
        if old_id.is_zero() {
            // Added by this commit → reverting removes it.
            let _ = std::fs::remove_file(&full);
        } else {
            let blob = repo.find_blob(old_id).map_err(git_err)?;
            std::fs::write(&full, blob.content())
                .map_err(|e| VoleeoError::Git(format!("Cannot write {p}: {e}")))?;
        }
    }
    Ok(())
}

fn blob_text(repo: &Repository, oid: Oid) -> Option<String> {
    if oid.is_zero() {
        return None;
    }
    let blob = repo.find_blob(oid).ok()?;
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}

fn head_text(repo: &Repository, rel: &str) -> Option<String> {
    let blob = repo
        .head()
        .ok()?
        .peel_to_tree()
        .ok()?
        .get_path(Path::new(rel))
        .ok()
        .and_then(|e| repo.find_blob(e.id()).ok())?;
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Unified patch (working tree vs HEAD) for one file — the raw "code diff" view in
/// the Changes window. Same direction as `changed_blobs`, but emits git's own
/// `DiffFormat::Patch` text. The `diff --git`/`index`/`---`/`+++` preamble is
/// dropped (the UI already labels the entity); hunk headers + content lines stay.
pub fn entity_diff_text(path: &Path, rel: &str) -> Result<String, VoleeoError> {
    let repo = open_repo(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(rel)
        .include_untracked(true)
        .show_untracked_content(true);
    let diff = repo
        .diff_tree_to_workdir(head_tree.as_ref(), Some(&mut opts))
        .map_err(git_err)?;
    let mut out = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            'F' => {} // drop the file-header preamble
            origin @ ('+' | '-' | ' ') => {
                out.push(origin);
                out.push_str(&String::from_utf8_lossy(line.content()));
            }
            // Hunk headers (`@@ … @@`) and EOFNL markers carry their own text.
            _ => out.push_str(&String::from_utf8_lossy(line.content())),
        }
        true
    })
    .map_err(git_err)?;
    Ok(out)
}
