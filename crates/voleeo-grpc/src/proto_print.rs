//! Render a resolved `DescriptorPool` back to `.proto` source. Used by export to
//! turn a reflection-fetched schema into importable `.proto` files (reflection
//! has no local files to copy). Well-known `google/protobuf/*` files are left as
//! imports — every protobuf toolchain already ships them.
//!
//! Rendering is from the stable `prost_types::FileDescriptorProto` rather than the
//! prost-reflect descriptor wrappers, so it tracks the protobuf wire descriptor
//! exactly. Comments and original formatting aren't recoverable from descriptors.

use std::collections::{BTreeMap, HashMap};

use prost_reflect::DescriptorPool;
use prost_types::{
    field_descriptor_proto::{Label, Type},
    DescriptorProto, EnumDescriptorProto, FieldDescriptorProto, FileDescriptorProto,
    ServiceDescriptorProto,
};

/// A `.proto` file to write: `path` is the descriptor's own relative name (e.g.
/// `helloworld.proto`, `google/api/http.proto`) so `import` statements resolve.
pub struct ProtoFile {
    pub path: String,
    pub content: String,
}

/// Render every non-well-known file in `pool` to `.proto` source, deduped by path.
pub fn pool_to_files(pool: &DescriptorPool) -> Vec<ProtoFile> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for file in pool.files() {
        let fd = file.file_descriptor_proto();
        if fd.name().starts_with("google/protobuf/") {
            continue;
        }
        out.entry(fd.name().to_string())
            .or_insert_with(|| render_file(fd));
    }
    out.into_iter()
        .map(|(path, content)| ProtoFile { path, content })
        .collect()
}

fn render_file(fd: &FileDescriptorProto) -> String {
    let proto3 = fd.syntax() == "proto3";
    let mut out = String::new();
    out.push_str(&format!(
        "syntax = \"{}\";\n\n",
        if proto3 { "proto3" } else { "proto2" }
    ));
    if !fd.package().is_empty() {
        out.push_str(&format!("package {};\n\n", fd.package()));
    }
    for dep in &fd.dependency {
        out.push_str(&format!("import \"{dep}\";\n"));
    }
    if !fd.dependency.is_empty() {
        out.push('\n');
    }
    for e in &fd.enum_type {
        render_enum(e, 0, &mut out);
        out.push('\n');
    }
    for m in &fd.message_type {
        render_message(m, proto3, 0, &mut out);
        out.push('\n');
    }
    for s in &fd.service {
        render_service(s, &mut out);
        out.push('\n');
    }
    out
}

fn render_message(m: &DescriptorProto, proto3: bool, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let pad1 = "  ".repeat(indent + 1);
    out.push_str(&format!("{pad}message {} {{\n", m.name()));

    // Synthetic map-entry messages render as `map<K,V>` on their field, not as
    // standalone nested messages.
    let map_entries: HashMap<&str, &DescriptorProto> = m
        .nested_type
        .iter()
        .filter(|n| {
            n.options
                .as_ref()
                .and_then(|o| o.map_entry)
                .unwrap_or(false)
        })
        .map(|n| (n.name(), n))
        .collect();

    // A oneof is synthetic when it backs a single proto3 `optional` field.
    let synthetic: Vec<bool> = (0..m.oneof_decl.len())
        .map(|i| {
            let mut fields = m.field.iter().filter(|f| f.oneof_index == Some(i as i32));
            match (fields.next(), fields.next()) {
                (Some(f), None) => f.proto3_optional.unwrap_or(false),
                _ => false,
            }
        })
        .collect();

    for f in &m.field {
        match f.oneof_index {
            None => render_field(f, proto3, false, &map_entries, &pad1, out),
            Some(i) if synthetic[i as usize] => {
                render_field(f, proto3, true, &map_entries, &pad1, out)
            }
            Some(_) => {}
        }
    }

    for (i, decl) in m.oneof_decl.iter().enumerate() {
        if synthetic[i] {
            continue;
        }
        out.push_str(&format!("{pad1}oneof {} {{\n", decl.name()));
        let pad2 = "  ".repeat(indent + 2);
        for f in m.field.iter().filter(|f| f.oneof_index == Some(i as i32)) {
            render_field(f, proto3, false, &map_entries, &pad2, out);
        }
        out.push_str(&format!("{pad1}}}\n"));
    }

    for e in &m.enum_type {
        render_enum(e, indent + 1, out);
    }

    for n in &m.nested_type {
        if map_entries.contains_key(n.name()) {
            continue;
        }
        render_message(n, proto3, indent + 1, out);
    }

    out.push_str(&format!("{pad}}}\n"));
}

fn render_field(
    f: &FieldDescriptorProto,
    proto3: bool,
    force_optional: bool,
    map_entries: &HashMap<&str, &DescriptorProto>,
    pad: &str,
    out: &mut String,
) {
    let repeated = f.label() == Label::Repeated;

    // A repeated message field pointing at a map-entry type is a `map<K,V>`.
    if repeated && f.r#type() == Type::Message {
        if let Some(entry) = f
            .type_name()
            .rsplit('.')
            .next()
            .and_then(|n| map_entries.get(n))
        {
            if let (Some(k), Some(v)) = (entry.field.first(), entry.field.get(1)) {
                out.push_str(&format!(
                    "{pad}map<{}, {}> {} = {};\n",
                    type_name(k),
                    type_name(v),
                    f.name(),
                    f.number()
                ));
                return;
            }
        }
    }

    let label = if proto3 {
        if repeated {
            "repeated "
        } else if force_optional || f.proto3_optional.unwrap_or(false) {
            "optional "
        } else {
            ""
        }
    } else {
        match f.label() {
            Label::Repeated => "repeated ",
            Label::Required => "required ",
            _ => "optional ",
        }
    };
    out.push_str(&format!(
        "{pad}{label}{} {} = {};\n",
        type_name(f),
        f.name(),
        f.number()
    ));
}

/// The `.proto` type token for a field — a scalar keyword or a message/enum name
/// (fully-qualified, leading dot stripped, which protobuf resolves from any scope).
fn type_name(f: &FieldDescriptorProto) -> String {
    match f.r#type() {
        Type::Message | Type::Enum | Type::Group => {
            f.type_name().trim_start_matches('.').to_string()
        }
        Type::Double => "double".into(),
        Type::Float => "float".into(),
        Type::Int64 => "int64".into(),
        Type::Uint64 => "uint64".into(),
        Type::Int32 => "int32".into(),
        Type::Fixed64 => "fixed64".into(),
        Type::Fixed32 => "fixed32".into(),
        Type::Bool => "bool".into(),
        Type::String => "string".into(),
        Type::Bytes => "bytes".into(),
        Type::Uint32 => "uint32".into(),
        Type::Sfixed32 => "sfixed32".into(),
        Type::Sfixed64 => "sfixed64".into(),
        Type::Sint32 => "sint32".into(),
        Type::Sint64 => "sint64".into(),
    }
}

fn render_enum(e: &EnumDescriptorProto, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let pad1 = "  ".repeat(indent + 1);
    out.push_str(&format!("{pad}enum {} {{\n", e.name()));
    for v in &e.value {
        out.push_str(&format!("{pad1}{} = {};\n", v.name(), v.number()));
    }
    out.push_str(&format!("{pad}}}\n"));
}

fn render_service(s: &ServiceDescriptorProto, out: &mut String) {
    out.push_str(&format!("service {} {{\n", s.name()));
    for m in &s.method {
        let cs = if m.client_streaming() { "stream " } else { "" };
        let ss = if m.server_streaming() { "stream " } else { "" };
        out.push_str(&format!(
            "  rpc {} ({cs}{}) returns ({ss}{});\n",
            m.name(),
            m.input_type().trim_start_matches('.'),
            m.output_type().trim_start_matches('.'),
        ));
    }
    out.push_str("}\n");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::descriptors::protos;

    fn compile(src: &str) -> DescriptorPool {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("demo.proto");
        std::fs::write(&path, src).unwrap();
        protos::compile(&[path.to_string_lossy().into_owned()], &[]).unwrap()
    }

    #[test]
    fn renders_and_recompiles() {
        let src = r#"
syntax = "proto3";
package demo;
enum Role { UNKNOWN = 0; ADMIN = 1; }
message User {
  string id = 1;
  repeated string tags = 2;
  map<string, int32> scores = 3;
  Role role = 4;
  optional string nickname = 5;
  oneof contact { string email = 6; string phone = 7; }
}
service Users {
  rpc Get (User) returns (User);
  rpc Watch (User) returns (stream User);
}
"#;
        let files = pool_to_files(&compile(src));
        assert_eq!(files.len(), 1);
        let r = &files[0].content;
        assert!(r.contains("map<string, int32> scores = 3;"), "{r}");
        assert!(r.contains("repeated string tags = 2;"), "{r}");
        assert!(r.contains("optional string nickname = 5;"), "{r}");
        assert!(r.contains("oneof contact {"), "{r}");
        assert!(
            r.contains("rpc Watch (demo.User) returns (stream demo.User);"),
            "{r}"
        );
        assert!(r.contains("role = 4;"), "{r}");

        // The rendered output must itself be valid proto.
        let pool2 = compile(r);
        assert!(pool2.get_message_by_name("demo.User").is_some());
        assert!(pool2.get_service_by_name("demo.Users").is_some());
    }
}
