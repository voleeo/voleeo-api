//! The Digest challenge-retry wrapper around `send_inner`. Split out of
//! `executor.rs` to keep it within the size limit; behavior is unchanged.

use crate::fmt::push_event;
use crate::redirect::RedirectHop;
use crate::HttpExecutor;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use voleeo_core::{
    AuthConfig, HttpRequest, HttpResponse, RequestParameter, StoredCookie, VoleeoError,
};

impl HttpExecutor {
    /// Wraps `send_inner` with the Digest challenge-retry: a `401` carrying a
    /// `WWW-Authenticate: Digest` triggers one retry with the computed
    /// `Authorization` header. Both legs appear in the timeline, joined by an
    /// `auth` row. Any other scheme/status passes through unchanged.
    pub(crate) async fn send_with_auth_retry(
        &self,
        request: &HttpRequest,
        started: Instant,
        redirect_hops: Arc<Mutex<Vec<RedirectHop>>>,
        attach_cookies: &[StoredCookie],
        capture_sink: &Arc<Mutex<Vec<StoredCookie>>>,
        attached_sink: &Arc<Mutex<Vec<StoredCookie>>>,
    ) -> Result<HttpResponse, VoleeoError> {
        if let AuthConfig::Ntlm {
            username,
            password,
            domain,
            workstation,
            ..
        } = &request.auth
        {
            if request.auth.is_active() {
                return crate::ntlm::send_ntlm(
                    request,
                    crate::ntlm::NtlmCreds {
                        username: username.clone(),
                        password: password.clone(),
                        domain: domain.clone(),
                        workstation: workstation.clone(),
                    },
                    started,
                )
                .await;
            }
        }

        let first = self
            .send_inner(
                request,
                started,
                redirect_hops.clone(),
                attach_cookies,
                capture_sink,
                attached_sink,
            )
            .await?;

        if first.status != 401 || !matches!(request.auth, AuthConfig::Digest { .. }) {
            return Ok(first);
        }
        let www: Vec<&str> = first
            .headers
            .iter()
            .filter(|h| h.name.eq_ignore_ascii_case("www-authenticate"))
            .map(|h| h.value.as_str())
            .collect();
        let Some((header, note)) = crate::auth::digest_authorization(&request.auth, request, &www)
        else {
            return Ok(first); // disabled, or no usable Digest challenge
        };

        // Retry with the Authorization header; clear `auth` so the second leg
        // treats it as a plain header (no second challenge attempt).
        let mut retry = request.clone();
        retry.headers.push(RequestParameter {
            id: "__auth".into(),
            name: "Authorization".into(),
            value: header,
            enabled: true,
        });
        retry.auth = AuthConfig::None;
        let mut second = self
            .send_inner(
                &retry,
                started,
                redirect_hops,
                attach_cookies,
                capture_sink,
                attached_sink,
            )
            .await?;

        let mut events = first.events;
        push_event(&mut events, started, "auth", note);
        events.append(&mut second.events);
        second.events = events;
        Ok(second)
    }
}
