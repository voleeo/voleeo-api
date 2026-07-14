use git2::{Cred, CredentialType, Error, RemoteCallbacks, Repository};
use std::cell::Cell;

/// Install the credential callback shared by clone/fetch/pull/push.
///
/// For HTTPS we use the caller-supplied `creds` (username + token) when present,
/// otherwise `config` (the repo's, or the global default for a clone with no repo
/// yet). For SSH we use the agent. We never fall back to `Cred::default()`:
/// libgit2 treats it as a passthrough (the callback declining), which it then
/// reports as the confusing "authentication required but no callback set".
/// Explicit errors surface actionable messages. The attempt counter stops
/// libgit2 looping forever on a rejected credential.
fn install_credentials(
    cb: &mut RemoteCallbacks<'static>,
    creds: Option<(String, String)>,
    config: Option<git2::Config>,
) {
    let attempts = Cell::new(0u32);
    cb.credentials(move |url, username, allowed| {
        if attempts.get() >= 4 {
            return Err(Error::from_str(
                "Authentication failed — check the username/token in Git settings, your SSH agent, or credential helper",
            ));
        }
        attempts.set(attempts.get() + 1);

        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some((user, pass)) = &creds {
                return Cred::userpass_plaintext(user, pass);
            }
            if let Some(config) = &config {
                if let Ok(cred) = Cred::credential_helper(config, url, username) {
                    return Ok(cred);
                }
            }
            return Err(Error::from_str(
                "No credentials for this HTTPS remote — add a username and token in Git \
                 settings, or use the SSH remote URL",
            ));
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            return Cred::ssh_key_from_agent(username.unwrap_or("git")).map_err(|_| {
                Error::from_str("SSH auth failed — add your key to ssh-agent (ssh-add), then retry")
            });
        }
        if allowed.contains(CredentialType::USERNAME) {
            return Cred::username(username.unwrap_or("git"));
        }
        Err(Error::from_str("Unsupported authentication method"))
    });
}

/// Auth callbacks for fetch/pull/push, plus push-rejection reporting.
pub(crate) fn remote_callbacks(
    repo: &Repository,
    creds: Option<(String, String)>,
) -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    install_credentials(&mut cb, creds, repo.config().ok());
    // Per-ref push rejection (e.g. non-fast-forward) is reported ONLY here —
    // without this callback libgit2 can return Ok from `push` on a rejected ref,
    // so the push silently no-ops. Turn it into an actionable error.
    cb.push_update_reference(|_refname, status| match status {
        None => Ok(()),
        Some(msg) => {
            let m = msg.to_ascii_lowercase();
            // Non-fast-forward (the common "remote has newer changes") gets a
            // short, actionable message; other rejections keep the raw reason.
            let text = if m.contains("fast-forward")
                || m.contains("fast forward")
                || m.contains("fetch first")
            {
                "Can't push! Update first.".to_string()
            } else {
                format!("Remote rejected the push: {msg}")
            };
            Err(Error::from_str(&text))
        }
    });
    cb
}

/// Like `remote_callbacks` but with no repo yet (clone) — resolves credentials
/// against the global git config.
pub(crate) fn clone_callbacks(creds: Option<(String, String)>) -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    install_credentials(&mut cb, creds, git2::Config::open_default().ok());
    cb
}
