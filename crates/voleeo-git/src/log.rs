use crate::{git_err, open_repo};
use git2::{Commit, DiffOptions, Sort};
use std::path::Path;
use voleeo_core::{GitCommit, VoleeoError};

pub fn log(path: &Path, limit: usize) -> Result<Vec<GitCommit>, VoleeoError> {
    let repo = open_repo(path)?;
    let mut walk = repo.revwalk().map_err(git_err)?;
    if walk.push_head().is_err() {
        return Ok(vec![]); // unborn HEAD — no history yet
    }
    walk.set_sorting(Sort::TIME).map_err(git_err)?;
    let commits = walk
        .flatten()
        .take(limit)
        .filter_map(|oid| repo.find_commit(oid).ok())
        .map(|c| to_commit(&c))
        .collect();
    Ok(commits)
}

/// Commits that touched `file` — powers "who changed this request".
pub fn log_for_path(path: &Path, file: &str, limit: usize) -> Result<Vec<GitCommit>, VoleeoError> {
    let repo = open_repo(path)?;
    let mut walk = repo.revwalk().map_err(git_err)?;
    if walk.push_head().is_err() {
        return Ok(vec![]);
    }
    walk.set_sorting(Sort::TIME).map_err(git_err)?;

    let mut out = Vec::new();
    for oid in walk.flatten() {
        if out.len() >= limit {
            break;
        }
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let Ok(tree) = commit.tree() else { continue };
        let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
        let mut opts = DiffOptions::new();
        opts.pathspec(file);
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
            .map_err(git_err)?;
        if diff.deltas().len() > 0 {
            out.push(to_commit(&commit));
        }
    }
    Ok(out)
}

pub(crate) fn to_commit(c: &Commit) -> GitCommit {
    let author = c.author();
    let id = c.id().to_string();
    GitCommit {
        short_id: id.chars().take(7).collect(),
        id,
        summary: c.summary().ok().flatten().unwrap_or_default().to_string(),
        author: author.name().unwrap_or_default().to_string(),
        email: author.email().unwrap_or_default().to_string(),
        timestamp: c.time().seconds() as f64,
    }
}
