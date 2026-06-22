//! Custom DNS resolver for reqwest that consults the per-workspace overrides
//! task-local first and falls back to the system resolver. The resolver is
//! registered once on the shared client; overrides are scoped per-send via
//! the `DNS_OVERRIDES` task-local, so a workspace's overrides only affect
//! that workspace's requests.

use crate::{DNS_OVERRIDES, GUARD_INTERNAL};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;

pub(crate) struct TaskLocalResolver;

impl Resolve for TaskLocalResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_ascii_lowercase();
        let overrides = DNS_OVERRIDES
            .try_with(|o| o.clone())
            .unwrap_or_else(|_| std::sync::Arc::new(Vec::new()));
        let guard = GUARD_INTERNAL.try_with(|g| *g).unwrap_or(false);

        Box::pin(async move {
            let collected: Vec<SocketAddr> = if let Some(ip) = overrides
                .iter()
                .find(|(h, _)| h == &host)
                .map(|(_, ip)| *ip)
            {
                vec![SocketAddr::new(ip, 0)]
            } else {
                tokio::net::lookup_host((host.as_str(), 0u16))
                    .await
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?
                    .collect()
            };

            if guard
                && collected
                    .iter()
                    .any(|a| voleeo_core::is_link_local_or_metadata(a.ip()))
            {
                return Err(Box::<dyn std::error::Error + Send + Sync>::from(format!(
                    "blocked request to internal/link-local address for host {host:?}"
                )));
            }

            let addrs: Addrs = Box::new(collected.into_iter());
            Ok(addrs)
        })
    }
}
