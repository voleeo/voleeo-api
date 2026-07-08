//! MCP tool schema definitions. `definitions()` concatenates the per-domain
//! lists; each domain fn lives next to the handlers it describes (`request` for
//! the HTTP domain, `streaming` for WebSocket + gRPC). This module keeps the
//! shared arg/schema helpers and the smaller workspace/env/cookie domains.

use crate::protocol::{bool_schema, obj_schema, str_schema, ToolDef};
use serde_json::Value;

mod request;
mod streaming;

/// Optional `reveal` arg shared by read tools that mask secrets by default.
pub(super) fn reveal_arg() -> (&'static str, &'static str, Value) {
    (
        "reveal",
        "Return secret values (auth tokens, passwords, env var values, cookie values) as plaintext instead of the default masked placeholder. Default false.",
        bool_schema(),
    )
}

/// Schema for a `{ "name": "value" }` string map (headers / query params).
pub(super) fn map_schema() -> Value {
    serde_json::json!({ "type": "object", "additionalProperties": { "type": "string" } })
}

/// Schema for a free-form request `body` object.
pub(super) fn body_schema() -> Value {
    serde_json::json!({ "type": "object" })
}

pub(in crate::api) fn definitions() -> Vec<ToolDef> {
    workspace_tools()
        .into_iter()
        .chain(request::request_tools())
        .chain(env_tools())
        .chain(cookie_tools())
        .chain(streaming::websocket_tools())
        .chain(streaming::grpc_tools())
        .collect()
}

fn workspace_tools() -> Vec<ToolDef> {
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
                &[(
                    "encrypted",
                    "Whether to encrypt at rest (default false)",
                    bool_schema(),
                )],
            ),
        },
    ]
}

fn env_tools() -> Vec<ToolDef> {
    vec![
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
    ]
}

fn cookie_tools() -> Vec<ToolDef> {
    vec![
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
    ]
}
