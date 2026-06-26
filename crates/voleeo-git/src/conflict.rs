use crate::commit::write_commit;
use crate::{classify_path, git_err, io_err, open_repo};
use git2::{DiffDelta, DiffHunk, DiffLine, Index, IndexEntry, Oid, Repository};
use std::cell::RefCell;
use std::path::Path;
use voleeo_core::{GitCommit, GitNodeKind, VoleeoError};

/// Each conflicted path paired with its "ours" (stage-2) blob oid, or `None` when
/// our side deleted the file. Collected eagerly because the `conflicts()` iterator
/// borrows the index immutably and callers need to mutate or write to disk after.
fn collect_conflict_ours(index: &Index) -> Result<Vec<(String, Option<Oid>)>, VoleeoError> {
    Ok(index
        .conflicts()
        .map_err(git_err)?
        .filter_map(Result::ok)
        .filter_map(|c| {
            let entry = c
                .our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())?;
            let p = String::from_utf8_lossy(&entry.path).into_owned();
            Some((p, c.our.as_ref().map(|e| e.id)))
        })
        .collect())
}

/// One conflicted file's three stage texts, read straight from the index — the
/// command layer parses + decrypts these into typed entities. `None` where a
/// stage is absent (e.g. delete/modify conflicts have no `ours` or `theirs`).
pub struct ConflictBlob {
    pub path: String,
    pub node_id: Option<String>,
    pub node_kind: GitNodeKind,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
}

/// Read the three sides of each conflict from the index stages (1/2/3), never
/// from worktree conflict markers.
pub fn conflict_blobs(path: &Path) -> Result<Vec<ConflictBlob>, VoleeoError> {
    let repo = open_repo(path)?;
    let index = repo.index().map_err(git_err)?;
    let mut out = Vec::new();
    for c in index.conflicts().map_err(git_err)? {
        let c = c.map_err(git_err)?;
        let path_bytes = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| e.path.clone())
            .unwrap_or_default();
        let p = String::from_utf8_lossy(&path_bytes).into_owned();
        let (node_kind, node_id) = classify_path(&p);
        out.push(ConflictBlob {
            path: p,
            node_id,
            node_kind,
            base: blob_text(&repo, &c.ancestor),
            ours: blob_text(&repo, &c.our),
            theirs: blob_text(&repo, &c.their),
        });
    }
    Ok(out)
}

pub fn conflict_diff_text(path: &Path, rel: &str) -> Result<String, VoleeoError> {
    let repo = open_repo(path)?;
    let index = repo.index().map_err(git_err)?;
    let (mut ours, mut theirs) = (None, None);
    for c in index.conflicts().map_err(git_err)? {
        let c = c.map_err(git_err)?;
        let p = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).into_owned());
        if p.as_deref() != Some(rel) {
            continue;
        }
        ours = c.our.as_ref().map(|e| e.id);
        theirs = c.their.as_ref().map(|e| e.id);
        break;
    }
    let ours_blob = ours
        .map(|o| repo.find_blob(o))
        .transpose()
        .map_err(git_err)?;
    let theirs_blob = theirs
        .map(|o| repo.find_blob(o))
        .transpose()
        .map_err(git_err)?;

    let out = RefCell::new(String::new());
    let mut hunk_cb = |_d: DiffDelta, hunk: DiffHunk| {
        out.borrow_mut()
            .push_str(&String::from_utf8_lossy(hunk.header()));
        true
    };
    let mut line_cb = |_d: DiffDelta, _h: Option<DiffHunk>, line: DiffLine| {
        let mut o = out.borrow_mut();
        match line.origin() {
            origin @ ('+' | '-' | ' ') => {
                o.push(origin);
                o.push_str(&String::from_utf8_lossy(line.content()));
            }
            // Hunk headers come via hunk_cb; the rest (EOFNL markers) carry text.
            'F' | 'H' => {}
            _ => o.push_str(&String::from_utf8_lossy(line.content())),
        }
        true
    };
    repo.diff_blobs(
        ours_blob.as_ref(),
        Some(rel),
        theirs_blob.as_ref(),
        Some(rel),
        None,
        None,
        None,
        Some(&mut hunk_cb),
        Some(&mut line_cb),
    )
    .map_err(git_err)?;
    Ok(out.into_inner())
}

/// Write the resolved file content, then stage it — staging a conflicted path
/// clears its conflict in the index.
pub fn resolve(path: &Path, file: &str, merged: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    std::fs::write(path.join(file), merged).map_err(io_err)?;
    let mut index = repo.index().map_err(git_err)?;
    index.add_path(Path::new(file)).map_err(git_err)?;
    index.write().map_err(git_err)?;
    Ok(())
}

/// Resolve a delete/modify conflict by accepting the deletion: remove the file
/// and drop it from the index (clears the conflict as a removal).
pub fn resolve_delete(path: &Path, file: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let abs = path.join(file);
    if abs.exists() {
        std::fs::remove_file(&abs).map_err(io_err)?;
    }
    let mut index = repo.index().map_err(git_err)?;
    index.remove_path(Path::new(file)).map_err(git_err)?;
    index.write().map_err(git_err)?;
    Ok(())
}

/// Restore conflicted working files to their local ("ours") version WITHOUT
/// clearing the index conflict — so a workspace left mid-merge keeps valid YAML
/// on disk (no `<<<<<<<` markers that brick parsing) while the conflict stays
/// fully resolvable in the index + MERGE_HEAD (the resolver reads index stages).
/// Idempotent; a no-op (returns `false`) when the repo isn't mid-merge.
pub fn heal_merge_worktree(path: &Path) -> Result<bool, VoleeoError> {
    let repo = open_repo(path)?;
    if repo.state() != git2::RepositoryState::Merge {
        return Ok(false);
    }
    let workdir = repo
        .workdir()
        .ok_or_else(|| VoleeoError::Git("bare repo has no working tree".into()))?
        .to_path_buf();
    let index = repo.index().map_err(git_err)?;
    let items = collect_conflict_ours(&index)?;
    let mut healed = false;
    for (p, ours) in items {
        let abs = workdir.join(&p);
        match ours {
            // Our side exists → write it back (overwrites any conflict markers).
            Some(oid) => {
                let blob = repo.find_blob(oid).map_err(git_err)?;
                std::fs::write(&abs, blob.content()).map_err(io_err)?;
                healed = true;
            }
            // Our side deleted the file (delete/modify) → keep it deleted locally.
            None => {
                if abs.exists() {
                    std::fs::remove_file(&abs).map_err(io_err)?;
                    healed = true;
                }
            }
        }
    }
    Ok(healed)
}

/// Commit the resolved merge (HEAD + MERGE_HEAD parents) and clear the merge
/// state. Any conflict the entity resolver didn't touch (non-entity files such
/// as the app-managed `.gitignore`) is accepted as "ours" first, so the merge
/// can always complete instead of dead-ending on `write_tree`.
pub fn finish_merge(
    path: &Path,
    message: &str,
    author: Option<(String, String)>,
) -> Result<GitCommit, VoleeoError> {
    let repo = open_repo(path)?;
    clear_leftover_conflicts(&repo)?;
    write_commit(&repo, message, author, true)
}

/// Force-resolve any still-conflicted index paths to the local ("ours") side —
/// or accept the deletion when ours is gone — so a leftover conflict in a file
/// the UI can't show never blocks the commit.
fn clear_leftover_conflicts(repo: &Repository) -> Result<(), VoleeoError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| VoleeoError::Git("bare repo has no working tree".into()))?
        .to_path_buf();
    let mut index = repo.index().map_err(git_err)?;
    let leftovers = collect_conflict_ours(&index)?;
    if leftovers.is_empty() {
        return Ok(());
    }
    for (p, our_oid) in leftovers {
        let rel = Path::new(&p);
        match our_oid {
            Some(oid) => {
                let blob = repo.find_blob(oid).map_err(git_err)?;
                std::fs::write(workdir.join(&p), blob.content()).map_err(io_err)?;
                index.add_path(rel).map_err(git_err)?;
            }
            None => {
                let abs = workdir.join(&p);
                if abs.exists() {
                    std::fs::remove_file(&abs).map_err(io_err)?;
                }
                index.remove_path(rel).map_err(git_err)?;
            }
        }
    }
    index.write().map_err(git_err)?;
    Ok(())
}

fn blob_text(repo: &Repository, entry: &Option<IndexEntry>) -> Option<String> {
    let blob = repo.find_blob(entry.as_ref()?.id).ok()?;
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}
