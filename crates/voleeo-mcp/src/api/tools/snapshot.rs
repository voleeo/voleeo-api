//! Saved-snapshot tool schemas. Handlers live in `api::snapshot`.
//!
//! No `snapshot.delete`/`snapshot.rename` — destructive/cosmetic ops stay human-only.

use super::reveal_arg;
use crate::protocol::{obj_schema, str_schema, ToolDef};

pub(super) fn snapshot_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "snapshot.save".into(),
            description: "Freeze a stored response and the exact resolved request that produced it into an immutable, git-synced saved snapshot — a point-in-time source of truth. Use response.list to pick a responseId first.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID the response belongs to", str_schema()),
                    ("responseId", "Stored response ID to freeze", str_schema()),
                ],
                &[("name", "Display name (default: '<status> <url>')", str_schema())],
            ),
        },
        ToolDef {
            name: "snapshot.list".into(),
            description: "List saved snapshots for a request — lightweight metadata only (id, name, createdAt, method, url, status). Use snapshot.get for the full frozen request/response.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("requestId", "Request ID", str_schema()),
                ],
                &[],
            ),
        },
        ToolDef {
            name: "snapshot.get".into(),
            description: "Get a saved snapshot: the frozen resolved request and response as captured at save time. In encrypted workspaces the response body/headers are decrypted for reading; auth secret values stay masked unless reveal=true.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("snapshotId", "Saved snapshot ID", str_schema()),
                ],
                &[reveal_arg()],
            ),
        },
        ToolDef {
            name: "snapshot.replay".into(),
            description: "Re-execute a saved snapshot and report whether the API still behaves as captured: static parts (URL/headers/body) replay verbatim, dynamic auth is re-signed from the saved credentials. Returns { statusMatches, saved: {status}, response }. The fresh response is stored machine-locally, never git-synced.".into(),
            input_schema: obj_schema(
                &[
                    ("workspaceId", "Workspace ID", str_schema()),
                    ("snapshotId", "Saved snapshot ID", str_schema()),
                ],
                &[],
            ),
        },
    ]
}
