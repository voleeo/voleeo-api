//! Descriptor-level tests (no network): compile a `.proto` with protox, then
//! exercise schema extraction, JSON⇆message conversion, and the dynamic codec's
//! encode/decode path. End-to-end calls against a live server are verified
//! manually (see the plan's verification section).

use crate::convert::{json_to_message, message_to_json};
use crate::descriptors::schema;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage};
use voleeo_core::{GrpcRpcKind, ProtoFieldType};

const PROTO: &str = r#"
syntax = "proto3";
package test.v1;

enum Color { RED = 0; GREEN = 1; }
message Inner { string label = 1; }
message Node { string id = 1; Node next = 2; }       // self-referential

message Req {
  string name = 1;
  int32 count = 2;
  bool active = 3;
  Color color = 4;
  Inner inner = 5;
  repeated string tags = 6;
  map<string, int32> scores = 7;
  oneof choice { string a = 8; int32 b = 9; }
  optional string nickname = 10;
}
message Resp { string greeting = 1; }

service Greeter {
  rpc Unary(Req) returns (Resp);
  rpc ServerStream(Req) returns (stream Resp);
  rpc ClientStream(stream Req) returns (Resp);
  rpc Bidi(stream Req) returns (stream Resp);
}
"#;

fn pool() -> DescriptorPool {
    let dir = std::env::temp_dir().join(format!("voleeo_grpc_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test.proto");
    std::fs::write(&path, PROTO).unwrap();
    let fds = protox::compile([&path], [&dir]).unwrap();
    let _ = std::fs::remove_file(&path);
    DescriptorPool::from_file_descriptor_set(fds).unwrap()
}

#[test]
fn lists_services_with_correct_rpc_kinds() {
    let services = schema::list_services(&pool());
    let svc = services
        .iter()
        .find(|s| s.name == "test.v1.Greeter")
        .expect("Greeter service");
    let kind = |name: &str| svc.methods.iter().find(|m| m.name == name).unwrap().kind;
    assert_eq!(kind("Unary"), GrpcRpcKind::Unary);
    assert_eq!(kind("ServerStream"), GrpcRpcKind::ServerStreaming);
    assert_eq!(kind("ClientStream"), GrpcRpcKind::ClientStreaming);
    assert_eq!(kind("Bidi"), GrpcRpcKind::Bidi);
}

#[test]
fn input_schema_describes_field_shapes() {
    let services = schema::list_services(&pool());
    let svc = services
        .iter()
        .find(|s| s.name == "test.v1.Greeter")
        .unwrap();
    let input = &svc
        .methods
        .iter()
        .find(|m| m.name == "Unary")
        .unwrap()
        .input;
    let field = |name: &str| input.fields.iter().find(|f| f.name == name).unwrap();

    assert!(field("tags").repeated);
    assert_eq!(field("a").oneof_group.as_deref(), Some("choice"));
    assert_eq!(field("b").oneof_group.as_deref(), Some("choice"));
    // proto3 `optional` is a synthetic oneof → surfaced as optional, not a group.
    assert!(field("nickname").optional);
    assert_eq!(field("nickname").oneof_group, None);

    assert!(matches!(field("color").ty, ProtoFieldType::Enum { .. }));
    assert!(matches!(field("scores").ty, ProtoFieldType::Map { .. }));
    assert!(matches!(field("inner").ty, ProtoFieldType::Message { .. }));
}

#[test]
fn self_referential_message_becomes_ref() {
    let p = pool();
    let node = schema::message_by_name(&p, "test.v1.Node").unwrap();
    let next = node.fields.iter().find(|f| f.name == "next").unwrap();
    assert!(
        matches!(&next.ty, ProtoFieldType::MessageRef { name } if name == "test.v1.Node"),
        "expected MessageRef to break the cycle, got {:?}",
        next.ty
    );
}

#[test]
fn json_message_codec_roundtrip() {
    let p = pool();
    let desc = p.get_message_by_name("test.v1.Req").unwrap();
    let json = r#"{"name":"Ada","count":3,"active":true,"color":"GREEN","tags":["x","y"]}"#;

    let msg = json_to_message(desc.clone(), json).unwrap();
    // Same path the DynamicCodec uses: prost encode → DynamicMessage::decode.
    let bytes = Message::encode_to_vec(&msg);
    let back = DynamicMessage::decode(desc, &bytes[..]).unwrap();

    let out = message_to_json(&back).unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["name"], "Ada");
    assert_eq!(v["count"], 3);
    assert_eq!(v["active"], true);
    assert_eq!(v["color"], "GREEN");
    assert_eq!(v["tags"], serde_json::json!(["x", "y"]));
}

#[test]
fn blank_json_is_empty_message() {
    let p = pool();
    let desc = p.get_message_by_name("test.v1.Req").unwrap();
    let msg = json_to_message(desc, "  ").unwrap();
    assert_eq!(Message::encode_to_vec(&msg).len(), 0);
}
