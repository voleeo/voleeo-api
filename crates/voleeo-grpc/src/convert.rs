//! protobuf-JSON ⇆ `DynamicMessage`. One JSON representation is shared by the
//! form editor, MCP, storage, and the wire codec.

use prost_reflect::{DeserializeOptions, DynamicMessage, MessageDescriptor, SerializeOptions};
use voleeo_core::VoleeoError;

/// Parse a protobuf-JSON string into a message of `desc`. Empty/blank input is
/// an empty message (all defaults), matching an unset payload in the UI.
pub fn json_to_message(desc: MessageDescriptor, json: &str) -> Result<DynamicMessage, VoleeoError> {
    if json.trim().is_empty() {
        return Ok(DynamicMessage::new(desc));
    }
    let mut de = serde_json::Deserializer::from_str(json);
    let msg = DynamicMessage::deserialize_with_options(desc, &mut de, &DeserializeOptions::new())
        .map_err(|e| VoleeoError::Grpc(format!("invalid message JSON: {e}")))?;
    de.end()
        .map_err(|e| VoleeoError::Grpc(format!("invalid message JSON: {e}")))?;
    Ok(msg)
}

/// Render a message as protobuf-JSON. Fields at their default are emitted so the
/// response view shows the full shape rather than an empty object.
pub fn message_to_json(msg: &DynamicMessage) -> Result<String, VoleeoError> {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::new(&mut buf);
    let opts = SerializeOptions::new().skip_default_fields(false);
    msg.serialize_with_options(&mut ser, &opts)
        .map_err(|e| VoleeoError::Grpc(format!("encode response JSON: {e}")))?;
    String::from_utf8(buf).map_err(|e| VoleeoError::Grpc(e.to_string()))
}
