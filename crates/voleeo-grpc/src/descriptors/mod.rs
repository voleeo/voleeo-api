//! Descriptor resolution + cache. A resolved pool is keyed per gRPC request id
//! (proto source + service/method are per-request) and rebuilt on demand.

pub mod protos;
pub mod reflection;
pub mod schema;

use prost_reflect::{DescriptorPool, MethodDescriptor};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use voleeo_core::{ProtoMessageSchema, ProtoServiceInfo, ProtoSource, VoleeoError};

/// A built descriptor pool plus the service tree the frontend renders.
pub struct ResolvedDescriptors {
    pub pool: DescriptorPool,
    pub services: Vec<ProtoServiceInfo>,
}

impl ResolvedDescriptors {
    fn from_pool(pool: DescriptorPool) -> Self {
        let services = schema::list_services(&pool);
        Self { pool, services }
    }

    /// Schema for any message by full name — backs lazy `MessageRef` expansion.
    pub fn describe_message(&self, full_name: &str) -> Option<ProtoMessageSchema> {
        schema::message_by_name(&self.pool, full_name)
    }

    /// Look up a method descriptor by service full-name + method name.
    pub fn method(&self, service: &str, method: &str) -> Result<MethodDescriptor, VoleeoError> {
        self.pool
            .get_service_by_name(service)
            .ok_or_else(|| VoleeoError::NotFound(format!("service {service}")))?
            .methods()
            .find(|m| m.name() == method)
            .ok_or_else(|| VoleeoError::NotFound(format!("method {service}/{method}")))
    }
}

/// One cache slot: the resolved pool plus the inputs it was built from, so a
/// request edit (target/source/tls) invalidates itself instead of relying on
/// every edit path to call `evict`.
struct CacheEntry {
    source: ProtoSource,
    target: String,
    tls: bool,
    resolved: Arc<ResolvedDescriptors>,
}

/// Process-wide cache of resolved descriptors, keyed by gRPC request id. Cheap
/// to clone (`Arc`). Never holds its lock across an `.await` (CLAUDE.md #19):
/// the network build happens outside the guard.
#[derive(Clone, Default)]
pub struct DescriptorCache {
    inner: Arc<Mutex<HashMap<String, CacheEntry>>>,
}

impl DescriptorCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cache hit only when the build inputs still match the request.
    fn cached(
        &self,
        id: &str,
        source: &ProtoSource,
        target: &str,
        tls: bool,
    ) -> Option<Arc<ResolvedDescriptors>> {
        let map = self.inner.lock().ok()?;
        let entry = map.get(id)?;
        (entry.source == *source && entry.target == target && entry.tls == tls)
            .then(|| entry.resolved.clone())
    }

    /// Resolved descriptors for a request, building (and caching) them if absent
    /// or stale.
    pub async fn get_or_build(
        &self,
        id: &str,
        source: &ProtoSource,
        target: &str,
        tls: bool,
    ) -> Result<Arc<ResolvedDescriptors>, VoleeoError> {
        if let Some(hit) = self.cached(id, source, target, tls) {
            return Ok(hit);
        }
        self.rebuild(id, source, target, tls).await
    }

    /// Force a rebuild (used by the explicit "refresh" command), replacing any
    /// cached entry.
    pub async fn rebuild(
        &self,
        id: &str,
        source: &ProtoSource,
        target: &str,
        tls: bool,
    ) -> Result<Arc<ResolvedDescriptors>, VoleeoError> {
        let pool = build_pool(source, target, tls).await?;
        let resolved = Arc::new(ResolvedDescriptors::from_pool(pool));
        if let Ok(mut map) = self.inner.lock() {
            map.insert(
                id.to_string(),
                CacheEntry {
                    source: source.clone(),
                    target: target.to_string(),
                    tls,
                    resolved: resolved.clone(),
                },
            );
        }
        Ok(resolved)
    }

    pub fn evict(&self, id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(id);
        }
    }
}

async fn build_pool(
    source: &ProtoSource,
    target: &str,
    tls: bool,
) -> Result<DescriptorPool, VoleeoError> {
    match source {
        ProtoSource::Reflection => reflection::fetch_pool(target, tls).await,
        // protox reads the .proto files from disk synchronously — keep it off
        // the async runtime (CLAUDE.md #17).
        ProtoSource::Files {
            paths,
            include_dirs,
        } => {
            let (paths, include_dirs) = (paths.clone(), include_dirs.clone());
            tokio::task::spawn_blocking(move || protos::compile(&paths, &include_dirs))
                .await
                .map_err(|e| VoleeoError::Grpc(format!("descriptor build task: {e}")))?
        }
    }
}
