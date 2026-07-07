//! Schemas for the live-connection protocols: WebSocket and gRPC.

use super::reveal_arg;
use crate::protocol::{obj_schema, str_schema, ToolDef};

pub(super) fn websocket_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "websocket.list".into(),
            description: "List all saved WebSocket connections in a workspace.".into(),
            input_schema: obj_schema(
                &[("workspaceId", "Workspace ID", str_schema())],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "websocket.create".into(),
            description: "Create a new WebSocket connection (ws:// or wss:// URL).".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("name", "Connection name", str_schema()),
                    ("url", "WebSocket URL (ws:// or wss://)", str_schema()),
                ],
                &[("folderId", "Parent folder ID", str_schema())],
            ),
        },
        ToolDef {
            name: "websocket.connect".into(),
            description: "Open a saved WebSocket connection. Handshake headers, auth, and {{ VAR }} tokens are resolved from the specified environment. Inbound messages stream to the transcript — read them with websocket.read_messages.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("connectionId", "Connection ID to open", str_schema()),
                ],
                &[("environmentId", "Personal environment ID whose variables resolve {{ VAR }} tokens.", str_schema())],
            ),
        },
        ToolDef {
            name: "websocket.send".into(),
            description: "Send a message over an open WebSocket connection.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("connectionId", "Open connection ID", str_schema()),
                    ("data", "Message payload (UTF-8 text, or base64 when kind=binary)", str_schema()),
                ],
                &[("kind", "Message kind: 'text' (default) or 'binary'", str_schema())],
            ),
        },
        ToolDef {
            name: "websocket.read_messages".into(),
            description: "Read the persisted transcript (recent messages + lifecycle events) for a connection.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("connectionId", "Connection ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "websocket.disconnect".into(),
            description: "Close an open WebSocket connection.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("connectionId", "Connection ID to close", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "websocket.delete".into(),
            description: "Delete a saved WebSocket connection (closes it first if open). Permanent.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("connectionId", "Connection ID to delete", str_schema()),
                ],
                &[],
            ),
        },
    ]
}

pub(super) fn grpc_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "grpc.list".into(),
            description: "List all gRPC requests in a workspace.".into(),
            input_schema: obj_schema(
                &[("workspaceId", "Workspace ID", str_schema())],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "grpc.create".into(),
            description: "Create a new gRPC request. The schema source defaults to server reflection; set service/method and a protobuf-JSON message before calling.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("name", "Request name", str_schema()),
                    ("target", "Server address as host:port (no scheme)", str_schema()),
                ],
                &[("folderId", "Parent folder ID", str_schema())],
            ),
        },
        ToolDef {
            name: "grpc.describe".into(),
            description: "Introspect a gRPC request's schema via reflection or its imported .proto. Returns the service list, or — when service+method are given — that method's RPC kind and input message schema, so you know the JSON shape to send.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID", str_schema()),
                ],
                &[
                    ("service", "Fully-qualified service name to describe a method of", str_schema()),
                    ("method", "Method name (requires service)", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "grpc.call".into(),
            description: "Run a unary gRPC call. The request message is protobuf-JSON; pass it via `message` (object or JSON string) or use the stored one. service/method override the stored selection. Returns the response message, status, and metadata.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID", str_schema()),
                ],
                &[
                    ("message", "Request message as protobuf-JSON (object or string)", str_schema()),
                    ("service", "Override the service to call", str_schema()),
                    ("method", "Override the method to call", str_schema()),
                    ("environmentId", "Environment whose variables resolve {{ VAR }} tokens", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "grpc.stream_start".into(),
            description: "Open a streaming gRPC call (server/client/bidirectional). Inbound messages stream to the transcript — read them with grpc.stream_read. For client/bidi, send with grpc.stream_send.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID", str_schema()),
                ],
                &[
                    ("message", "First/only request message as protobuf-JSON", str_schema()),
                    ("service", "Override the service", str_schema()),
                    ("method", "Override the method", str_schema()),
                    ("environmentId", "Environment for {{ VAR }} resolution", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "grpc.stream_send".into(),
            description: "Send a client→server message on an open client-streaming or bidirectional call.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID of the open stream", str_schema()),
                    ("message", "Message as protobuf-JSON string", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "grpc.stream_read".into(),
            description: "Read the persisted transcript (recent messages + lifecycle events) for a streaming gRPC call.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "grpc.stream_close".into(),
            description: "Cancel/close an open streaming gRPC call.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "grpc.delete".into(),
            description: "Delete a saved gRPC request (cancels any in-flight call first). Permanent.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("id", "gRPC request ID to delete", str_schema()),
                ],
                &[],
            ),
        },
    ]
}
