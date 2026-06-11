//! Dynamic gRPC client — the gRPC counterpart of `voleeo-http`/`voleeo-ws`.
//! No compile-time codegen: schemas come from server reflection or local
//! `.proto` files, messages are `prost_reflect::DynamicMessage` carried by a
//! custom `DynamicCodec`, and payloads cross the boundary as protobuf-JSON.

pub mod channel;
pub mod codec;
pub mod convert;
pub mod descriptors;
pub mod executor;
pub mod manager;

#[cfg(test)]
mod tests;

pub use codec::DynamicCodec;
pub use descriptors::{DescriptorCache, ResolvedDescriptors};
pub use executor::GrpcExecutor;
pub use manager::{GrpcEvent, GrpcEventSink, GrpcManager, StreamSpec};
