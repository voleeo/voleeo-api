//! gRPC request, response, transcript, and protobuf-schema types.

use super::common::RequestParameter;
use super::http::{HttpResponseHeader, TimelineEvent};
use super::ws::WsDirection;
use crate::auth::AuthConfig;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Where a gRPC request's protobuf schema comes from. `Reflection` queries the
/// server's reflection service at send time; `Files` compiles local `.proto`s
/// (absolute paths) — files are referenced, never copied into the workspace.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtoSource {
    #[default]
    Reflection,
    Files {
        paths: Vec<String>,
        #[serde(default)]
        include_dirs: Vec<String>,
    },
}

/// The four gRPC call shapes, derived from the method descriptor's
/// client/server streaming flags.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrpcRpcKind {
    Unary,
    ServerStreaming,
    ClientStreaming,
    Bidi,
}

/// A saved gRPC request — the gRPC counterpart of `HttpRequest`/`WsConnection`.
/// Lives in the workspace tree as `grpc_{id}.yaml`. `message` is the request
/// payload in protobuf-JSON (the form editor, MCP, and the dynamic codec all
/// share this single representation). `metadata` rides the call as gRPC
/// metadata (HTTP/2 headers); `auth` maps to metadata at send time.
#[derive(Type, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    pub model: String,
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    /// `host:port` (no scheme). `tls` selects h2 over TLS vs plaintext h2c.
    pub target: String,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub proto_source: ProtoSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metadata: Vec<RequestParameter>,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub order: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// One streaming-call transcript row. `data` is protobuf-JSON (mirrors
/// `WsMessage`); `size` is its byte length.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamMessage {
    pub id: String,
    pub direction: WsDirection,
    pub data: String,
    pub size: u32,
    pub at: String,
}

/// Result of a unary gRPC call. `status_code` is the gRPC status (0 = OK);
/// `message` is the response payload in protobuf-JSON. `metadata`/`trailers`
/// carry response headers and trailers.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcResponse {
    pub request_id: String,
    pub status_code: i32,
    pub status_message: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub metadata: Vec<HttpResponseHeader>,
    #[serde(default)]
    pub trailers: Vec<HttpResponseHeader>,
    pub total_ms: f64,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
    #[serde(default)]
    pub response_id: String,
}

/// A protobuf enum member, for rendering an enum field as a select.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoEnumValue {
    pub name: String,
    pub number: i32,
}

/// The type of a single message field — the discriminant the form renders from.
/// `MessageRef` breaks recursion/depth: the frontend lazily expands it via
/// `grpc_describe_message`. `Map` carries its key/value element types.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtoFieldType {
    /// Protobuf scalar; `name` is the proto type (`string`, `int32`, `bool`, …).
    Scalar {
        name: String,
    },
    Enum {
        name: String,
        values: Vec<ProtoEnumValue>,
    },
    Message {
        schema: Box<ProtoMessageSchema>,
    },
    MessageRef {
        name: String,
    },
    Map {
        key: Box<ProtoFieldType>,
        value: Box<ProtoFieldType>,
    },
}

/// One field of a message, flattened for form rendering. `oneof_group` ties
/// mutually-exclusive fields together; `repeated`/`optional` drive widgets.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFieldSchema {
    pub name: String,
    pub number: i32,
    pub ty: ProtoFieldType,
    pub repeated: bool,
    pub optional: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oneof_group: Option<String>,
}

/// A message's field set — the schema the generated form renders.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMessageSchema {
    pub name: String,
    pub fields: Vec<ProtoFieldSchema>,
}

/// A method's I/O shape: the RPC kind plus the input message schema and the
/// output message's full name (the form only needs to build the request).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMethodInfo {
    pub name: String,
    pub full_name: String,
    pub kind: GrpcRpcKind,
    pub input: ProtoMessageSchema,
    pub output_name: String,
}

/// A service and its methods, returned by `grpc_list_services`.
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtoServiceInfo {
    pub name: String,
    pub methods: Vec<ProtoMethodInfo>,
}
