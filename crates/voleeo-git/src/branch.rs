use crate::{git_err, open_repo};
use git2::{build::CheckoutBuilder, BranchType};
use std::path::Path;
use voleeo_core::{GitBranch, VoleeoError};

/// Local branches, sorted by name, with the checked-out one flagged.
pub fn branches(path: &Path) -> Result<Vec<GitBranch>, VoleeoError> {
    let repo = open_repo(path)?;
    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from));
    let mut out = Vec::new();
    for b in repo.branches(Some(BranchType::Local)).map_err(git_err)? {
        let (branch, _) = b.map_err(git_err)?;
        if let Some(name) = branch.name().map_err(git_err)? {
            out.push(GitBranch {
                current: Some(name) == current.as_deref(),
                name: name.to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Switch to `branch` (like `git checkout`). A SAFE checkout carries
/// non-conflicting uncommitted edits over to the new branch and only fails when
/// a local change would actually clash with it.
pub fn checkout_branch(path: &Path, branch: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let refname = format!("refs/heads/{branch}");
    let obj = repo.revparse_single(&refname).map_err(git_err)?;
    let mut co = CheckoutBuilder::new();
    co.safe();
    repo.checkout_tree(&obj, Some(&mut co)).map_err(|_| {
        VoleeoError::Git(
            "some of your changes clash with that branch — publish or discard them first".into(),
        )
    })?;
    repo.set_head(&refname).map_err(git_err)?;
    Ok(())
}

/// Rename a local branch (like `git branch -m old new`). libgit2 moves HEAD
/// with it when `old` is the checked-out branch, so the working tree is
/// untouched. Fails if `new` already exists (no force).
pub fn rename_branch(path: &Path, old: &str, new: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let mut branch = repo.find_branch(old, BranchType::Local).map_err(git_err)?;
    branch.rename(new, false).map_err(git_err)?;
    Ok(())
}

/// Create `name` at HEAD and switch to it (like `git checkout -b`). The working
/// tree is unchanged (same commit), so uncommitted edits carry over.
pub fn create_branch(path: &Path, name: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let head = repo
        .head()
        .map_err(git_err)?
        .peel_to_commit()
        .map_err(git_err)?;
    repo.branch(name, &head, false).map_err(git_err)?;
    repo.set_head(&format!("refs/heads/{name}"))
        .map_err(git_err)?;
    Ok(())
}
