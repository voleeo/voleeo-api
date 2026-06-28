//! Secret handling for export: flatten inline `encrypt()` chips to plaintext and
//! count them for the warning. `for_each_text*` below are the single home for
//! "which text fields a workspace exports" — the decrypt-sweep and the chip-count
//! both go through them, so the field list can't drift between the two.

use voleeo_core::{
    ApiFolder, EnvironmentVariable, GrpcRequest, HttpRequest, Workspace, WsConnection,
};
use voleeo_export::Bundle;

/// Decrypt every inline `{{ encrypt(value="…") }}` chip / `enc:v1:` blob in the
/// bundle's text fields to plaintext. (Inline chips only exist on encrypted
/// workspaces, so the caller passes the workspace key.)
pub(super) fn sweep_inline(bundle: &mut Bundle, key: &[u8; 32]) {
    let Bundle {
        workspace,
        folders,
        requests,
        ws,
        grpc,
        environments,
    } = bundle;
    for_each_text_mut(workspace, folders, requests, ws, grpc, |s| sweep(s, key));
    for env in environments.iter_mut() {
        for v in env.variables.iter_mut() {
            sweep(&mut v.value, key);
        }
    }
}

fn sweep(s: &mut String, key: &[u8; 32]) {
    if voleeo_crypto::has_encrypt_chip(s) || voleeo_crypto::is_encrypted(s) {
        *s = voleeo_crypto::decrypt_inline_text(s, key);
    }
}

/// Count inline `encrypt()` chips in the always-exported (non-env) fields.
pub(super) fn non_env_inline_count(
    workspace: &Workspace,
    folders: &[ApiFolder],
    requests: &[HttpRequest],
    ws: &[WsConnection],
    grpc: &[GrpcRequest],
) -> u32 {
    let mut n = 0;
    for_each_text(workspace, folders, requests, ws, grpc, |s| n += chips(s));
    n
}

/// Count inline chips embedded in environment variable values.
pub(super) fn vars_inline_count(vars: &[EnvironmentVariable]) -> u32 {
    vars.iter().map(|v| chips(&v.value)).sum()
}

fn chips(t: &str) -> u32 {
    t.matches("encrypt(value=").count() as u32
}

/// The single source of truth for the non-env text fields a workspace exports.
/// `for_each_text` is its read-only mirror — keep the two field lists identical.
fn for_each_text_mut(
    workspace: &mut Workspace,
    folders: &mut [ApiFolder],
    requests: &mut [HttpRequest],
    ws: &mut [WsConnection],
    grpc: &mut [GrpcRequest],
    mut f: impl FnMut(&mut String),
) {
    for p in &mut workspace.headers {
        f(&mut p.value);
    }
    for fo in folders {
        for p in &mut fo.headers {
            f(&mut p.value);
        }
        for v in &mut fo.variables {
            f(&mut v.value);
        }
    }
    for r in requests {
        f(&mut r.url);
        for p in r.parameters.iter_mut().chain(r.headers.iter_mut()) {
            f(&mut p.value);
        }
        if let Some(b) = &mut r.body {
            f(&mut b.text);
            for bf in b.fields.iter_mut().flatten() {
                f(&mut bf.value);
            }
        }
    }
    for w in ws {
        f(&mut w.url);
        for p in w.parameters.iter_mut().chain(w.headers.iter_mut()) {
            f(&mut p.value);
        }
    }
    for g in grpc {
        f(&mut g.target);
        f(&mut g.message);
        for p in &mut g.metadata {
            f(&mut p.value);
        }
    }
}

fn for_each_text(
    workspace: &Workspace,
    folders: &[ApiFolder],
    requests: &[HttpRequest],
    ws: &[WsConnection],
    grpc: &[GrpcRequest],
    mut f: impl FnMut(&str),
) {
    for p in &workspace.headers {
        f(&p.value);
    }
    for fo in folders {
        for p in &fo.headers {
            f(&p.value);
        }
        for v in &fo.variables {
            f(&v.value);
        }
    }
    for r in requests {
        f(&r.url);
        for p in r.parameters.iter().chain(r.headers.iter()) {
            f(&p.value);
        }
        if let Some(b) = &r.body {
            f(&b.text);
            for bf in b.fields.iter().flatten() {
                f(&bf.value);
            }
        }
    }
    for w in ws {
        f(&w.url);
        for p in w.parameters.iter().chain(w.headers.iter()) {
            f(&p.value);
        }
    }
    for g in grpc {
        f(&g.target);
        f(&g.message);
        for p in &g.metadata {
            f(&p.value);
        }
    }
}
