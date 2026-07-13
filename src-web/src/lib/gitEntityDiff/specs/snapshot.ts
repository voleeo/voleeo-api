import type { Snapshot } from "../../../../../packages/types/bindings"
import { blob, type Field, scalar } from "../engine"

// A saved snapshot is immutable except name/pinned, so the review only surfaces
// those plus read-only context (method/URL/status). The read-only fields use
// no-op setters — an individual field can't be reverted; discard the whole
// snapshot instead.
const readOnly = () => {}

export const snapshotSpecs: Field<Snapshot>[] = [
  scalar(
    "name",
    "General",
    (e) => e.name,
    (e, v) => {
      e.name = v
    },
    { label: "Name" },
  ),
  scalar(
    "pinned",
    "General",
    (e) => (e.pinned ? "pinned" : ""),
    (e, v) => {
      e.pinned = v === "pinned"
    },
    { label: "Pinned" },
  ),
  scalar("method", "Metadata", (e) => e.request.method, readOnly, {
    label: "Method",
  }),
  scalar("url", "URL", (e) => e.request.url, readOnly, { label: "URL" }),
  scalar("status", "Metadata", (e) => String(e.response.status), readOnly, {
    label: "Status",
  }),
  scalar(
    "responseSize",
    "Response",
    (e) => `${e.response.bodySize} bytes`,
    readOnly,
    { label: "Size" },
  ),
  blob(
    "responseBody",
    "Response",
    (e) => e.response.body,
    (e) => e.response.body,
    readOnly,
    { label: "Body" },
  ),
]
