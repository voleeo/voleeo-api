use crate::{git_err, open_repo, remote::remotes};
use git2::{BranchType, Repository, RepositoryInitOptions, RepositoryState};
use std::path::Path;
use voleeo_core::{GitIdentity, GitRepoInfo, VoleeoError};

pub fn init(path: &Path) -> Result<(), VoleeoError> {
    // libgit2 hardcodes the unborn branch to `master` and ignores
    // `init.defaultBranch`, so set the initial HEAD to `main` explicitly.
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    Repository::init_opts(path, &opts).map_err(git_err)?;
    Ok(())
}

/// Write `user.name`/`user.email` to the repo-local git config so commits and
/// `has_author` use them without re-prompting.
pub fn set_identity(path: &Path, name: &str, email: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let mut cfg = repo.config().map_err(git_err)?;
    cfg.set_str("user.name", name).map_err(git_err)?;
    cfg.set_str("user.email", email).map_err(git_err)?;
    Ok(())
}

/// Current commit identity from git config (local → global), if any.
pub fn get_identity(path: &Path) -> Result<Option<GitIdentity>, VoleeoError> {
    let repo = open_repo(path)?;
    let Ok(cfg) = repo.config() else {
        return Ok(None);
    };
    match cfg.get_string("user.name") {
        Ok(name) => Ok(Some(GitIdentity {
            name,
            email: cfg.get_string("user.email").unwrap_or_default(),
        })),
        Err(_) => Ok(None),
    }
}

/// Repo-level snapshot. `encrypted` / `unencrypted_secrets` are left false here —
/// the command layer fills them from workspace metadata.
pub fn repo_info(path: &Path) -> Result<GitRepoInfo, VoleeoError> {
    let Ok(repo) = Repository::open(path) else {
        return Ok(not_a_repo());
    };
    let detached = repo.head_detached().unwrap_or(false);
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from));
    let remotes = remotes(path).unwrap_or_default();
    let (ahead, behind) = ahead_behind(&repo).unwrap_or((0, 0));
    let merging = repo.state() == RepositoryState::Merge;
    let has_author = repo
        .config()
        .ok()
        .and_then(|c| c.get_string("user.name").ok())
        .is_some();

    Ok(GitRepoInfo {
        is_repo: true,
        has_remote: !remotes.is_empty(),
        remotes,
        branch,
        detached,
        ahead,
        behind,
        merging,
        has_author,
        encrypted: false,
        unencrypted_secrets: false,
    })
}

fn not_a_repo() -> GitRepoInfo {
    GitRepoInfo {
        is_repo: false,
        branch: None,
        detached: false,
        has_remote: false,
        remotes: vec![],
        ahead: 0,
        behind: 0,
        merging: false,
        has_author: false,
        encrypted: false,
        unencrypted_secrets: false,
    }
}

/// Ahead/behind the upstream branch. With a remote but no upstream yet (before
/// the first push), every local commit counts as "ahead" so the Push CTA shows
/// what a first push would send. None when HEAD is detached.
pub(crate) fn ahead_behind(repo: &Repository) -> Option<(u32, u32)> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    let local_oid = head.target()?;
    let branch = repo
        .find_branch(head.shorthand().ok()?, BranchType::Local)
        .ok()?;

    match branch.upstream() {
        Ok(upstream) => {
            let up_oid = upstream.get().target()?;
            let (a, b) = repo.graph_ahead_behind(local_oid, up_oid).ok()?;
            Some((a as u32, b as u32))
        }
        Err(_) => {
            // No upstream yet (branch never pushed). If ANY remote exists, every
            // local commit counts as "ahead" — what a first push would send.
            // Match `has_remote` (any remote), not a hard-coded "origin".
            if repo.remotes().map(|r| r.is_empty()).unwrap_or(true) {
                return Some((0, 0));
            }
            let mut walk = repo.revwalk().ok()?;
            walk.push(local_oid).ok()?;
            Some((walk.count() as u32, 0))
        }
    }
}
