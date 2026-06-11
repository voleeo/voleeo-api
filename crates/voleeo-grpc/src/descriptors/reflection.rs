//! gRPC server-reflection client. Discovers services and pulls their file
//! descriptors over the `ServerReflection` bidi stream, transitively fetching
//! any missing dependency files, then assembles a `DescriptorPool`.
//!
//! Negotiation: try `grpc.reflection.v1` first; on `Unimplemented` (older
//! servers expose only `v1alpha`), retry the alpha service. The two protos are
//! structurally identical, so the collection logic is generated once per
//! version by the `collector!` macro.

use prost::Message;
use prost_reflect::DescriptorPool;
use prost_types::FileDescriptorProto;
use std::collections::{HashMap, HashSet};
use tonic::transport::Channel;
use tonic::{Code, Status};
use voleeo_core::VoleeoError;

/// Fetch and build the descriptor pool via reflection, with v1→v1alpha fallback.
pub async fn fetch_pool(target: &str, tls: bool) -> Result<DescriptorPool, VoleeoError> {
    let channel = crate::channel::build(target, tls).await?;
    let files = match collect_v1(channel.clone()).await {
        Ok(files) => files,
        Err(status) if status.code() == Code::Unimplemented => collect_v1alpha(channel)
            .await
            .map_err(|e| VoleeoError::Grpc(format!("reflection (v1alpha): {e}")))?,
        Err(status) => return Err(VoleeoError::Grpc(format!("reflection: {status}"))),
    };
    build_pool(files)
}

/// One reflection round-trip: open a fresh stream carrying a single request and
/// read its single response. `$ReqTy` is the per-version request struct.
macro_rules! reflect_once {
    ($client:expr, $ReqTy:ident, $req:expr) => {{
        let request = $ReqTy {
            host: String::new(),
            message_request: Some($req),
        };
        let mut stream = $client
            .server_reflection_info(tokio_stream::once(request))
            .await?
            .into_inner();
        stream
            .message()
            .await?
            .and_then(|r| r.message_response)
            .ok_or_else(|| Status::internal("empty reflection response"))?
    }};
}

/// Generates `collect_<version>(channel) -> Result<Vec<Vec<u8>>, Status>`,
/// returning the raw `FileDescriptorProto` bytes of every service plus deps.
macro_rules! collector {
    ($name:ident, $pb:path) => {
        async fn $name(channel: Channel) -> Result<Vec<Vec<u8>>, Status> {
            use $pb::{
                server_reflection_client::ServerReflectionClient,
                server_reflection_request::MessageRequest,
                server_reflection_response::MessageResponse, ServerReflectionRequest,
            };

            let mut client = ServerReflectionClient::new(channel);
            let mut files: HashMap<String, Vec<u8>> = HashMap::new();

            let listed = reflect_once!(
                client,
                ServerReflectionRequest,
                MessageRequest::ListServices(String::new())
            );
            let MessageResponse::ListServicesResponse(list) = listed else {
                return Err(Status::internal("expected ListServicesResponse"));
            };

            for svc in list.service {
                let resp = reflect_once!(
                    client,
                    ServerReflectionRequest,
                    MessageRequest::FileContainingSymbol(svc.name)
                );
                if let MessageResponse::FileDescriptorResponse(fd) = resp {
                    index_files(&mut files, fd.file_descriptor_proto);
                }
            }

            // Pull any dependency files the server didn't bundle. Each dep is
            // requested at most once — a server that errors or returns a file
            // under a different name than asked would otherwise loop forever.
            let mut requested: HashSet<String> = HashSet::new();
            loop {
                let missing = missing_deps(&files);
                if missing.is_empty() {
                    break;
                }
                let fresh: Vec<String> = missing
                    .iter()
                    .filter(|d| !requested.contains(*d))
                    .cloned()
                    .collect();
                if fresh.is_empty() {
                    return Err(Status::internal(format!(
                        "reflection server never provided dependencies: {}",
                        missing.join(", ")
                    )));
                }
                for dep in fresh {
                    requested.insert(dep.clone());
                    let resp = reflect_once!(
                        client,
                        ServerReflectionRequest,
                        MessageRequest::FileByFilename(dep.clone())
                    );
                    match resp {
                        MessageResponse::FileDescriptorResponse(fd) => {
                            index_files(&mut files, fd.file_descriptor_proto);
                        }
                        MessageResponse::ErrorResponse(err) => {
                            return Err(Status::internal(format!(
                                "reflection error for {dep}: {}",
                                err.error_message
                            )));
                        }
                        _ => {
                            return Err(Status::internal(format!(
                                "expected FileDescriptorResponse for {dep}"
                            )));
                        }
                    }
                }
            }

            Ok(files.into_values().collect())
        }
    };
}

collector!(collect_v1, tonic_reflection::pb::v1);
collector!(collect_v1alpha, tonic_reflection::pb::v1alpha);

/// Index raw `FileDescriptorProto` bytes by their declared file name, ignoring
/// undecodable or unnamed entries.
fn index_files(files: &mut HashMap<String, Vec<u8>>, raw: Vec<Vec<u8>>) {
    for bytes in raw {
        if let Some(name) = FileDescriptorProto::decode(&bytes[..])
            .ok()
            .and_then(|f| f.name)
        {
            files.entry(name).or_insert(bytes);
        }
    }
}

/// Dependency file names referenced by collected files but not yet present.
fn missing_deps(files: &HashMap<String, Vec<u8>>) -> Vec<String> {
    let mut missing: Vec<String> = files
        .values()
        .filter_map(|b| FileDescriptorProto::decode(&b[..]).ok())
        .flat_map(|f| f.dependency)
        .filter(|dep| !files.contains_key(dep))
        .collect();
    missing.sort();
    missing.dedup();
    missing
}

fn build_pool(files: Vec<Vec<u8>>) -> Result<DescriptorPool, VoleeoError> {
    let protos: Vec<FileDescriptorProto> = files
        .iter()
        .filter_map(|b| FileDescriptorProto::decode(&b[..]).ok())
        .collect();
    let mut pool = DescriptorPool::new();
    // Order-independent: prost-reflect resolves dependencies internally as long
    // as every referenced file is present (guaranteed by the transitive fetch).
    pool.add_file_descriptor_protos(protos)
        .map_err(|e| VoleeoError::Grpc(format!("build descriptor pool: {e}")))?;
    Ok(pool)
}
