use crate::{git_err, open_repo};
use git2::BranchType;
use std::path::Path;
use voleeo_core::{GitRemoteInfo, VoleeoError};

pub fn remotes(path: &Path) -> Result<Vec<GitRemoteInfo>, VoleeoError> {
    let repo = open_repo(path)?;
    let names = repo.remotes().map_err(git_err)?;
    let mut out = Vec::new();
    for name in names.iter().flatten().flatten() {
        if let Ok(r) = repo.find_remote(name) {
            out.push(GitRemoteInfo {
                name: name.to_string(),
                url: r.url().unwrap_or_default().to_string(),
            });
        }
    }
    Ok(out)
}

pub fn set_remote(path: &Path, name: &str, url: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    if repo.find_remote(name).is_ok() {
        repo.remote_set_url(name, url).map_err(git_err)?;
    } else {
        repo.remote(name, url).map_err(git_err)?;
    }
    Ok(())
}

pub fn set_upstream(path: &Path, remote: &str, branch: &str) -> Result<(), VoleeoError> {
    let repo = open_repo(path)?;
    let mut b = repo
        .find_branch(branch, BranchType::Local)
        .map_err(git_err)?;
    b.set_upstream(Some(&format!("{remote}/{branch}")))
        .map_err(git_err)?;
    Ok(())
}
