//! Schemas for the HTTP request domain: requests, folders, response history,
//! and the SSE readers.

use super::{body_schema, map_schema, reveal_arg};
use crate::protocol::{num_schema, obj_schema, str_schema, ToolDef};

pub(super) fn request_tools() -> Vec<ToolDef> {
    vec![
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
    ]
}
