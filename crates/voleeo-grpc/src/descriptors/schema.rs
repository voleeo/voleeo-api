//! Turns a `DescriptorPool` into the serializable `ProtoServiceInfo` tree the
//! frontend form renders from. Recursion is bounded: a message already on the
//! current path, or past `MAX_DEPTH`, becomes a `MessageRef` the UI expands
//! lazily — otherwise self-referential types (e.g. `Struct`) recurse forever.

use prost_reflect::{
    DescriptorPool, EnumDescriptor, FieldDescriptor, Kind, MessageDescriptor, MethodDescriptor,
};
use voleeo_core::{
    GrpcRpcKind, ProtoEnumValue, ProtoFieldSchema, ProtoFieldType, ProtoMessageSchema,
    ProtoMethodInfo, ProtoServiceInfo,
};

const MAX_DEPTH: usize = 8;

pub fn list_services(pool: &DescriptorPool) -> Vec<ProtoServiceInfo> {
    pool.services()
        .map(|svc| ProtoServiceInfo {
            name: svc.full_name().to_string(),
            methods: svc.methods().map(method_info).collect(),
        })
        .collect()
}

pub fn method_info(method: MethodDescriptor) -> ProtoMethodInfo {
    let kind = match (method.is_client_streaming(), method.is_server_streaming()) {
        (false, false) => GrpcRpcKind::Unary,
        (false, true) => GrpcRpcKind::ServerStreaming,
        (true, false) => GrpcRpcKind::ClientStreaming,
        (true, true) => GrpcRpcKind::Bidi,
    };
    ProtoMethodInfo {
        name: method.name().to_string(),
        full_name: method.full_name().to_string(),
        kind,
        input: message_schema(&method.input(), 0, &mut Vec::new()),
        output_name: method.output().full_name().to_string(),
    }
}

/// Build the schema for one message. `path` holds the message full-names on the
/// current recursion branch so a back-edge collapses to a `MessageRef`.
pub fn message_schema(
    desc: &MessageDescriptor,
    depth: usize,
    path: &mut Vec<String>,
) -> ProtoMessageSchema {
    path.push(desc.full_name().to_string());
    let fields = desc
        .fields()
        .map(|f| field_schema(&f, depth, path))
        .collect();
    path.pop();
    ProtoMessageSchema {
        name: desc.full_name().to_string(),
        fields,
    }
}

fn field_schema(field: &FieldDescriptor, depth: usize, path: &mut [String]) -> ProtoFieldSchema {
    // A proto3 `optional` field sits in a synthetic single-field oneof named
    // `_field`; surface it as plain optional, not a user-facing oneof group.
    let oneof_group = field.containing_oneof().and_then(|o| {
        let synthetic = o.name().starts_with('_') && o.fields().count() == 1;
        (!synthetic).then(|| o.name().to_string())
    });
    ProtoFieldSchema {
        name: field.name().to_string(),
        number: field.number() as i32,
        ty: field_type(field, depth, path),
        repeated: field.is_list(),
        optional: field.supports_presence(),
        oneof_group,
    }
}

fn field_type(field: &FieldDescriptor, depth: usize, path: &mut [String]) -> ProtoFieldType {
    if field.is_map() {
        if let Kind::Message(entry) = field.kind() {
            return ProtoFieldType::Map {
                key: Box::new(element_type(&entry.map_entry_key_field(), depth, path)),
                value: Box::new(element_type(&entry.map_entry_value_field(), depth, path)),
            };
        }
    }
    element_type(field, depth, path)
}

/// The type of a single element (a map field's key/value, or a scalar/list
/// field's element), ignoring repetition.
fn element_type(field: &FieldDescriptor, depth: usize, path: &mut [String]) -> ProtoFieldType {
    match field.kind() {
        Kind::Message(m) => {
            let seen = path.iter().any(|p| p == m.full_name());
            if seen || depth >= MAX_DEPTH {
                ProtoFieldType::MessageRef {
                    name: m.full_name().to_string(),
                }
            } else {
                let mut owned = path.to_vec();
                ProtoFieldType::Message {
                    schema: Box::new(message_schema(&m, depth + 1, &mut owned)),
                }
            }
        }
        Kind::Enum(e) => ProtoFieldType::Enum {
            name: e.full_name().to_string(),
            values: enum_values(&e),
        },
        scalar => ProtoFieldType::Scalar {
            name: scalar_name(&scalar).to_string(),
        },
    }
}

fn enum_values(e: &EnumDescriptor) -> Vec<ProtoEnumValue> {
    e.values()
        .map(|v| ProtoEnumValue {
            name: v.name().to_string(),
            number: v.number(),
        })
        .collect()
}

fn scalar_name(kind: &Kind) -> &'static str {
    match kind {
        Kind::Double => "double",
        Kind::Float => "float",
        Kind::Int32 => "int32",
        Kind::Int64 => "int64",
        Kind::Uint32 => "uint32",
        Kind::Uint64 => "uint64",
        Kind::Sint32 => "sint32",
        Kind::Sint64 => "sint64",
        Kind::Fixed32 => "fixed32",
        Kind::Fixed64 => "fixed64",
        Kind::Sfixed32 => "sfixed32",
        Kind::Sfixed64 => "sfixed64",
        Kind::Bool => "bool",
        Kind::String => "string",
        Kind::Bytes => "bytes",
        // Message/Enum handled by the caller.
        Kind::Message(_) | Kind::Enum(_) => "message",
    }
}

/// Build the schema for an arbitrary message by full name — backs the lazy
/// `MessageRef` expansion in the form.
pub fn message_by_name(pool: &DescriptorPool, full_name: &str) -> Option<ProtoMessageSchema> {
    let desc = pool.get_message_by_name(full_name)?;
    Some(message_schema(&desc, 0, &mut Vec::new()))
}
