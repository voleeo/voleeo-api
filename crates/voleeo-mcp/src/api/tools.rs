use crate::protocol::{bool_schema, num_schema, obj_schema, str_schema, ToolDef};
use serde_json::Value;

/// Optional `reveal` arg shared by read tools that mask secrets by default.
fn reveal_arg() -> (&'static str, &'static str, Value) {
    (
        "reveal",
        "Return secret values (auth tokens, passwords, env var values, cookie values) as plaintext instead of the default masked placeholder. Default false.",
        bool_schema(),
    )
}

/// Schema for a `{ "name": "value" }` string map (headers / query params).
fn map_schema() -> Value {
    serde_json::json!({ "type": "object", "additionalProperties": { "type": "string" } })
}

/// Schema for a free-form request `body` object.
fn body_schema() -> Value {
    serde_json::json!({ "type": "object" })
}

pub(super) fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "workspace.list".into(),
            description: "List all API workspaces.".into(),
            input_schema: obj_schema(&[], &[]),
        },
        ToolDef {
            name: "workspace.create".into(),
            description: "Create a new API workspace.".into(),
            input_schema: obj_schema(
                &[("name", "Workspace name", str_schema())],
                &[("encrypted", "Whether to encrypt at rest (default false)", bool_schema())],
            ),
        },
        ToolDef {
            name: "request.list".into(),
            description: "List all requests and folders in a workspace.".into(),
            input_schema: obj_schema(
                &[("workspaceId", "Workspace ID", str_schema())],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "request.get".into(),
            description: "Get a single request by ID.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "request.create".into(),
            description: "Create a new HTTP request in a workspace. headers, query params, and a body can be set here in one call.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("name", "Request name", str_schema()),
                    ("method", "HTTP method (GET, POST, …)", str_schema()),
                    ("url", "Request URL", str_schema()),
                ],
                &[
                    ("folderId", "Parent folder ID", str_schema()),
                    ("headers", "Request headers as an object map {\"Header-Name\":\"value\"} (or an array of {name,value,enabled?} for duplicate/disabled rows).", map_schema()),
                    ("queryParams", "Query params as an object map {\"key\":\"value\"} (or an array of {name,value,enabled?}).", map_schema()),
                    ("body", "Request body: {\"kind\":\"json|xml|text|html|none\",\"text\":\"…\"} for raw bodies, or {\"kind\":\"form_url_encoded\",\"fields\":{\"k\":\"v\"}} for forms. Use graphqlQuery (on request.update) for GraphQL; multipart/binary uploads aren't supported.", body_schema()),
                ],
            ),
        },
        ToolDef {
            name: "request.update".into(),
            description: "Update an existing request's method, URL, name, headers, query params, body, or auth (any subset; omitted fields are left unchanged). Setting `graphqlQuery` turns it into a GraphQL request — a plain HTTP POST with a `{ query, variables }` JSON body; send it with request.send.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID to update", str_schema()),
                ],
                &[
                    ("method", "New HTTP method", str_schema()),
                    ("url", "New URL", str_schema()),
                    ("name", "New name", str_schema()),
                    ("headers", "Replace headers. Object map {\"Header-Name\":\"value\"} (or array of {name,value,enabled?}). Omit to leave unchanged.", map_schema()),
                    ("queryParams", "Replace query params. Object map {\"key\":\"value\"} (or array of {name,value,enabled?}). Omit to leave unchanged.", map_schema()),
                    ("body", "Replace the body: {\"kind\":\"json|xml|text|html|none\",\"text\":\"…\"} or {\"kind\":\"form_url_encoded\",\"fields\":{\"k\":\"v\"}}. Omit to leave unchanged.", body_schema()),
                    ("graphqlQuery", "GraphQL query/mutation document; sets a GraphQL body (auto-switches a GET to POST)", str_schema()),
                    ("graphqlVariables", "GraphQL variables as a JSON object string; updates the variables of an existing GraphQL body", str_schema()),
                    ("auth", "Auth config object keyed by `kind`. kinds: none, inherit, bearer {token}, basic {username,password}, api_key {key,value,location}, aws_sig_v4, o_auth1, o_auth2, digest {username,password}, ntlm. Send plaintext secrets — they're encrypted at rest on encrypted workspaces. Example: {\"kind\":\"bearer\",\"token\":\"abc\"}.", serde_json::json!({ "type": "object", "properties": { "kind": { "type": "string", "description": "Auth kind" } }, "required": ["kind"], "additionalProperties": true })),
                ],
            ),
        },
        ToolDef {
            name: "request.duplicate".into(),
            description: "Duplicate a request.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID to duplicate", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "request.delete".into(),
            description: "Delete a request permanently.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID to delete", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "request.send".into(),
            description: "Send an HTTP request and return the response. Template variables ({{ VAR }}) are resolved from the specified environment. The response is also saved to history.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID to send", str_schema()),
                ],
                &[
                    ("environmentId", "Personal environment ID whose variables resolve {{ VAR }} tokens. Global variables are always included. Use env.list to find IDs.", str_schema()),
                    ("urlOverride", "Override the resolved URL for this send only", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "folder.create".into(),
            description: "Create a new folder in a workspace.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("name", "Folder name", str_schema()),
                ],
                &[("folderId", "Parent folder ID", str_schema())],
            ),
        },
        ToolDef {
            name: "folder.rename".into(),
            description: "Rename a folder. Returns the updated folder.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("folderId", "Folder ID to rename", str_schema()),
                    ("name", "New name", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "folder.delete".into(),
            description: "Delete a folder and EVERYTHING inside it (nested folders and requests) — cascading, permanent.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("folderId", "Folder ID to delete", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "response.list".into(),
            description: "List saved response history for a request (newest first).".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "response.get".into(),
            description: "Get a full saved response by ID.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                    ("responseId", "Response ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "sse.tail".into(),
            description: "Last N parsed Server-Sent Events frames from a request's stored response (the latest unless `responseId` is given). Each frame is {seq,event,data,atMs}.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[
                    ("responseId", "Stored response ID (default: latest)", str_schema()),
                    ("limit", "Max frames to return (default 50)", num_schema()),
                    ("event", "Only frames with this event type (e.g. \"message\")", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "sse.summary".into(),
            description: "Overview of a stored SSE response: status, frame count, total received, byte total, duration, and per-event-type counts — without dumping every frame.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[(
                    "responseId",
                    "Stored response ID (default: latest)",
                    str_schema(),
                )],
            ),
        },
        ToolDef {
            name: "sse.assemble".into(),
            description: "Concatenate SSE frame data into one string — e.g. reassemble an LLM token stream. With `field`, parse each frame's data as JSON and join that field (e.g. \"delta\"); without it, join raw data with newlines.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[
                    ("responseId", "Stored response ID (default: latest)", str_schema()),
                    ("field", "JSON field to extract from each frame's data (e.g. \"delta\", \"content\")", str_schema()),
                    ("event", "Only frames with this event type", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "env.list".into(),
            description: "List all environments in a workspace.".into(),
            input_schema: obj_schema(
                &[("workspaceId", "Workspace ID", str_schema())],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "env.create".into(),
            description: "Create a new environment.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("name", "Environment name", str_schema()),
                ],
                &[
                    ("color", "Color label (hex string)", str_schema()),
                    ("shared", "Whether to sync with workspace (default false)", bool_schema()),
                ],
            ),
        },
        ToolDef {
            name: "env.set_variable".into(),
            description: "Set, update, or delete a variable in an environment. Creates the variable if it doesn't exist; pass delete=true to remove it.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("envId", "Environment ID", str_schema()),
                    ("key", "Variable key", str_schema()),
                ],
                &[
                    ("value", "Variable value (plaintext; encrypted at rest when `encrypted` is true on an encrypted workspace). Required unless delete=true.", str_schema()),
                    ("delete", "Remove the variable named by `key` (no `value` needed). Default false.", bool_schema()),
                    ("enabled", "Whether the variable is active (default true)", bool_schema()),
                    ("encrypted", "Store this value encrypted at rest (encrypted workspaces only). Defaults to the variable's current setting, or false for a new variable.", bool_schema()),
                ],
            ),
        },
        ToolDef {
            name: "env.delete".into(),
            description: "Delete an environment. The Global Environment cannot be deleted.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("envId", "Environment ID to delete", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "cookie.list_jars".into(),
            description: "List all cookie jars in a workspace, including each jar's cookies (values masked unless reveal=true). Use this to discover which jar is currently active before sending a request.".into(),
            input_schema: obj_schema(
                &[("workspaceId", "Workspace ID", str_schema())],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "cookie.set_active_jar".into(),
            description: "Switch which cookie jar request.send uses for the given workspace. Returns { workspaceId, activeJarId }.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("jarId", "Cookie jar ID to activate", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "cookie.set_cookie".into(),
            description: "Upsert a single cookie in a jar by (domain, path, name). Plant a session token before sending, or override a captured cookie. Value is encrypted at rest if the workspace is encrypted.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("jarId", "Cookie jar ID", str_schema()),
                    ("domain", "Cookie domain (e.g. 'api.example.com')", str_schema()),
                    ("name", "Cookie name", str_schema()),
                    ("value", "Cookie value (plaintext; encrypted on save when workspace is encrypted)", str_schema()),
                ],
                &[
                    ("path", "URL path scope (default '/')", str_schema()),
                    ("hostOnly", "Match exactly this host (no subdomains; default true)", bool_schema()),
                    ("secure", "Only send over HTTPS (default false)", bool_schema()),
                    ("httpOnly", "Not exposed to JavaScript (default false)", bool_schema()),
                    ("sameSite", "SameSite attribute: 'Strict', 'Lax', or 'None'", str_schema()),
                    ("expires", "RFC 3339 expiry timestamp; omit for session cookie", str_schema()),
                ],
            ),
        },
        ToolDef {
            name: "cookie.clear_jar".into(),
            description: "Remove every cookie in a jar. Useful for resetting state between test runs. Returns the empty jar.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("jarId", "Cookie jar ID to clear", str_schema()),
                ],
                &[],
            ),
        },
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
