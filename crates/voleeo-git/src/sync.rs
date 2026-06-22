use crate::commit::write_commit;
use crate::cred::{clone_callbacks, remote_callbacks};
use crate::{git_err, open_repo};
use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{BranchType, FetchOptions, PushOptions, Repository, Status, StatusOptions};
use std::path::Path;
use voleeo_core::{GitMergeResult, VoleeoError};

/// Clone `url` into `dest`. `creds` (username + token) are used for HTTPS;
/// otherwise the SSH agent / system credential helper.
pub fn clone(url: &str, dest: &Path, creds: Option<(String, String)>) -> Result<(), VoleeoError> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(clone_callbacks(creds));
    let mut builder = RepoBuilder::new();
    builder.fetch_options(fo);
    builder.clone(url, dest).map_err(git_err)?;
    Ok(())
}

/// `creds` is an optional (username, token) pair for HTTPS remotes.
pub fn fetch(path: &Path, creds: Option<(String, String)>) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    do_fetch(&repo, creds)
}

/// Fetch `origin`, then fast-forward or merge `FETCH_HEAD`. A conflicted merge
/// leaves conflicts in the index (`conflicted: true`) for the resolver.
pub fn pull(path: &Path, creds: Option<(String, String)>) -> Result<GitMergeResult, VoleeoError> {
    let repo = open_repo(path)?;
    // Drop timestamp-only churn — the UI hides it, so it would block the merge
    // with a phantom change the user can't see or commit.
    crate::status::discard_volatile_changes(path)?;
    // The checkout would clobber uncommitted edits — refuse early like git does.
    if has_local_changes(&repo)? {
        return Err(VoleeoError::Git(
            "You have uncommitted changes — commit or discard them first".into(),
        ));
    }
    do_fetch(&repo, creds)?;

    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(git_err)?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(git_err)?;
    let (analysis, _) = repo.merge_analysis(&[&fetch_commit]).map_err(git_err)?;

    if analysis.is_up_to_date() {
        return Ok(GitMergeResult {
            fast_forwarded: false,
            conflicted: false,
            up_to_date: true,
        });
    }

    if analysis.is_fast_forward() {
        fast_forward(&repo, fetch_commit.id())?;
        return Ok(GitMergeResult {
            fast_forwarded: true,
            conflicted: false,
            up_to_date: false,
        });
    }

    repo.merge(&[&fetch_commit], None, None).map_err(git_err)?;
    let conflicted = repo.index().map_err(git_err)?.has_conflicts();
    if conflicted {
        // Keep the worktree as valid YAML (conflict lives in index + MERGE_HEAD)
        // so the workspace stays openable mid-merge — no markers on disk.
        crate::conflict::heal_merge_worktree(path)?;
        return Ok(GitMergeResult {
            fast_forwarded: false,
            conflicted: true,
            up_to_date: false,
        });
    }
    // Clean merge — commit it right away with both parents.
    write_commit(&repo, "Merge remote changes", None, true)?;
    Ok(GitMergeResult {
        fast_forwarded: false,
        conflicted: false,
        up_to_date: false,
    })
}

/// Collapse libgit2's verbose non-fast-forward rejection into the actionable
/// short form; keep the raw reason for other push failures.
fn map_push_err(e: git2::Error) -> VoleeoError {
    let m = e.message().to_ascii_lowercase();
    if m.contains("not present locally")
        || m.contains("fast-forward")
        || m.contains("fast forward")
        || m.contains("fetch first")
        || m.contains("non-fast")
    {
        VoleeoError::Git("Can't push! Update first.".into())
    } else {
        git_err(e)
    }
}

pub fn push(path: &Path, creds: Option<(String, String)>) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from))
        .ok_or_else(|| VoleeoError::Git("Detached HEAD — checkout a branch to push".into()))?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    {
        let mut remote = repo.find_remote("origin").map_err(git_err)?;
        let mut opts = PushOptions::new();
        opts.remote_callbacks(remote_callbacks(&repo, creds));
        remote
            .push(&[refspec.as_str()], Some(&mut opts))
            .map_err(map_push_err)?;
    }
    // First push of a new branch: wire up the upstream so ahead/behind works.
    if let Ok(mut b) = repo.find_branch(&branch, BranchType::Local) {
        if b.upstream().is_err() {
            b.set_upstream(Some(&format!("origin/{branch}"))).ok();
        }
    }
    Ok(())
}

/// True when tracked files have staged or worktree modifications. Untracked-only
/// files don't block a merge, so they're ignored here.
pub(crate) fn has_local_changes(repo: &Repository) -> Result<bool, VoleeoError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git_err)?;
    let blocking = Status::INDEX_NEW
        | Status::INDEX_MODIFIED
        | Status::INDEX_DELETED
        | Status::INDEX_RENAMED
        | Status::INDEX_TYPECHANGE
        | Status::WT_MODIFIED
        | Status::WT_DELETED
        | Status::WT_RENAMED
        | Status::WT_TYPECHANGE
        | Status::CONFLICTED;
    Ok(statuses.iter().any(|e| e.status().intersects(blocking)))
}

fn do_fetch(repo: &Repository, creds: Option<(String, String)>) -> Result<(), VoleeoError> {
    let mut remote = repo.find_remote("origin").map_err(git_err)?;
    let refspecs: Vec<String> = remote
        .fetch_refspecs()
        .map_err(git_err)?
        .iter()
        .flatten()
        .flatten()
        .map(String::from)
        .collect();
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(remote_callbacks(repo, creds));
    remote
        .fetch(&refspecs, Some(&mut opts), None)
        .map_err(git_err)?;
    Ok(())
}

fn fast_forward(repo: &Repository, target: git2::Oid) -> Result<(), VoleeoError> {
    match repo.head() {
        Ok(head) => {
            let name = head
                .name()
                .ok()
                .map(String::from)
                .ok_or_else(|| VoleeoError::Git("unnamed HEAD reference".into()))?;
            let mut r = repo.find_reference(&name).map_err(git_err)?;
            r.set_target(target, "pull: fast-forward")
                .map_err(git_err)?;
            repo.set_head(&name).map_err(git_err)?;
        }
        Err(_) => {
            // Unborn HEAD: point the default branch at the fetched commit.
            repo.reference("refs/heads/main", target, true, "pull: initial")
                .map_err(git_err)?;
            repo.set_head("refs/heads/main").map_err(git_err)?;
        }
    }
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.checkout_head(Some(&mut co)).map_err(git_err)?;
    Ok(())
}
