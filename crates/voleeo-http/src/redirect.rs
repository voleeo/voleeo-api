use crate::fmt::push_event_at;
use std::sync::{Arc, Mutex};
use voleeo_core::{HttpRequest, RedirectInfo, TimelineEvent};

#[derive(Debug, Clone)]
pub(crate) struct RedirectHop {
    pub(crate) status: u16,
    pub(crate) to: String,
    pub(crate) at_ms: f64,
}

/// Take the hops recorded so far, emitting a timeline row for each and clearing
/// the shared Vec. Called from both the success and error paths so a failed
/// redirect chain still shows up — and draining (not just reading) means a
/// second auth-retry leg sharing this Arc re-reports only *its own* hops.
/// Returns the drained hops so the caller can compute a warning consistent with
/// exactly the leg being reported.
pub(crate) fn drain_redirect_hops(
    redirect_hops: &Arc<Mutex<Vec<RedirectHop>>>,
    events: &mut Vec<TimelineEvent>,
) -> Vec<RedirectHop> {
    let hops = match redirect_hops.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(_) => return Vec::new(),
    };
    for hop in &hops {
        push_event_at(
            events,
            hop.at_ms,
            "redirect",
            format!("{} → {}", hop.status, hop.to),
        );
    }
    hops
}

/// Detect request data silently dropped while following redirects: a body lost
/// to a 301/302/303 method downgrade, or sensitive headers stripped on a
/// cross-origin hop. Returns `None` when redirects were clean (or absent).
/// Takes the hops drained for this leg so the warning matches the reported rows.
pub(crate) fn compute_redirect_warning(
    request: &HttpRequest,
    origin_host: &str,
    hops: &[RedirectHop],
) -> Option<RedirectInfo> {
    if hops.is_empty() {
        return None;
    }

    let method = request.method.to_uppercase();
    let had_body = request.body.as_ref().is_some_and(crate::body::has_content);
    // 301/302/303 turn a non-GET/HEAD request into GET, discarding the body.
    let body_dropped = had_body
        && !matches!(method.as_str(), "GET" | "HEAD")
        && hops.iter().any(|h| matches!(h.status, 301..=303));

    // Cross-origin redirects strip sensitive headers (reqwest's behaviour).
    const SENSITIVE: &[&str] = &["authorization", "cookie", "proxy-authorization"];
    let crossed_origin = hops.iter().any(|h| {
        reqwest::Url::parse(&h.to)
            .ok()
            .and_then(|u| u.host_str().map(|hs| hs != origin_host))
            .unwrap_or(false)
    });
    let dropped_headers: Vec<String> = if crossed_origin {
        request
            .headers
            .iter()
            .filter(|hd| {
                let name = hd.name.trim().to_ascii_lowercase();
                hd.enabled && SENSITIVE.contains(&name.as_str())
            })
            .map(|hd| hd.name.trim().to_string())
            .collect()
    } else {
        Vec::new()
    };

    if !body_dropped && dropped_headers.is_empty() {
        return None;
    }
    Some(RedirectInfo {
        hop_count: hops.len() as u32,
        body_dropped,
        dropped_headers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::{AuthConfig, BodyKind, HttpRequest, RequestBody, RequestParameter};

    fn bare_request(url: &str, method: &str) -> HttpRequest {
        HttpRequest {
            id: "test-req".into(),
            request_type: "http".into(),
            model: "request".into(),
            workspace_id: "ws".into(),
            folder_id: None,
            method: method.into(),
            name: "Test".into(),
            url: url.into(),
            parameters: vec![],
            headers: vec![],
            body: None,
            auth: AuthConfig::None,
            order: 0.0,
            created_at: "2024-01-01T00:00:00.000000".into(),
            updated_at: "2024-01-01T00:00:00.000000".into(),
        }
    }

    fn hops(list: &[(u16, &str)]) -> Vec<RedirectHop> {
        list.iter()
            .map(|(s, t)| RedirectHop {
                status: *s,
                to: t.to_string(),
                at_ms: 0.0,
            })
            .collect()
    }

    #[test]
    fn no_hops_returns_none() {
        let req = bare_request("https://example.com", "POST");
        assert!(compute_redirect_warning(&req, "example.com", &hops(&[])).is_none());
    }

    #[test]
    fn drain_takes_hops_and_clears_the_shared_vec() {
        let shared = Arc::new(Mutex::new(hops(&[
            (301, "https://example.com/a"),
            (302, "https://example.com/b"),
        ])));
        let mut events = Vec::new();
        let taken = drain_redirect_hops(&shared, &mut events);
        assert_eq!(taken.len(), 2, "drain returns the hops");
        assert_eq!(events.len(), 2, "each hop emits a timeline row");
        assert!(
            shared.lock().unwrap().is_empty(),
            "shared Vec is cleared so a second leg won't re-report these"
        );
        // A second drain (the retry leg) sees an empty Vec, not the first leg's hops.
        let mut events2 = Vec::new();
        assert!(drain_redirect_hops(&shared, &mut events2).is_empty());
        assert!(events2.is_empty());
    }

    #[test]
    fn body_dropped_on_302_post() {
        let mut req = bare_request("https://example.com", "POST");
        req.body = Some(RequestBody {
            kind: BodyKind::Json,
            text: r#"{"x":1}"#.into(),
            ..Default::default()
        });
        let warn = compute_redirect_warning(
            &req,
            "example.com",
            &hops(&[(302, "https://example.com/new")]),
        )
        .unwrap();
        assert!(warn.body_dropped);
        assert!(warn.dropped_headers.is_empty());
    }

    #[test]
    fn body_not_dropped_for_get() {
        let req = bare_request("https://example.com", "GET");
        assert!(compute_redirect_warning(
            &req,
            "example.com",
            &hops(&[(302, "https://example.com/new")])
        )
        .is_none());
    }

    #[test]
    fn cross_origin_strips_auth_header() {
        let mut req = bare_request("https://a.com", "GET");
        req.headers = vec![RequestParameter {
            id: "h1".into(),
            name: "Authorization".into(),
            value: "Bearer tok".into(),
            enabled: true,
        }];
        let warn =
            compute_redirect_warning(&req, "a.com", &hops(&[(301, "https://b.com/path")])).unwrap();
        assert!(warn
            .dropped_headers
            .iter()
            .any(|h| h.eq_ignore_ascii_case("Authorization")));
    }

    #[test]
    fn same_origin_no_header_drop() {
        let mut req = bare_request("https://a.com", "GET");
        req.headers = vec![RequestParameter {
            id: "h1".into(),
            name: "Authorization".into(),
            value: "Bearer tok".into(),
            enabled: true,
        }];
        assert!(
            compute_redirect_warning(&req, "a.com", &hops(&[(301, "https://a.com/other")]))
                .is_none()
        );
    }
}
