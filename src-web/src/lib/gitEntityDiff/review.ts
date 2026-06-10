import type {
  GitEntity,
  GitEntityChange,
} from "../../../../packages/types/bindings"
import { buildFields } from "./engine"
import {
  type FolderRef,
  innerOf,
  locationOf,
  statusOf,
  TYPE_WORD,
  wrap,
} from "./entity"
import { revertField } from "./merge"
import { SPECS_BY_TYPE } from "./specs"
import {
  type EntityChange,
  type EntityType,
  type FieldChange,
  GROUP_ORDER,
  nodeKindToType,
} from "./types"

function residualChange(
  type: EntityType,
  // biome-ignore lint/suspicious/noExplicitAny: inner entity, type-narrowed by caller.
  oldInner: any,
  // biome-ignore lint/suspicious/noExplicitAny: inner entity, type-narrowed by caller.
  newInner: any,
  folders: Map<string, string>,
): FieldChange {
  const movable =
    type === "request" || type === "folder" || type === "websocket"
  if (
    movable &&
    (oldInner?.folderId ?? null) !== (newInner?.folderId ?? null)
  ) {
    return {
      group: "General",
      label: "Location",
      kind: "changed",
      before: locationOf(type, oldInner, folders),
      after: locationOf(type, newInner, folders),
    }
  }
  if (movable && (oldInner?.order ?? null) !== (newInner?.order ?? null)) {
    const earlier = (newInner?.order ?? 0) < (oldInner?.order ?? 0)
    return {
      group: "General",
      label: "Order",
      kind: "changed",
      before: "Previous order",
      after: earlier ? "Moved earlier" : "Moved later",
    }
  }
  return {
    group: "General",
    label: "Details",
    kind: "changed",
    before: "Saved version",
    after: "Your changes",
  }
}

export function buildReview(
  changes: GitEntityChange[],
  folders: FolderRef[] = [],
): EntityChange[] {
  const fmap = new Map(folders.map((f) => [f.id, f.name]))
  const out: EntityChange[] = []
  for (const c of changes) {
    const type = nodeKindToType(c.nodeKind)
    if (!type) continue
    const oldInner = innerOf(c.old, type)
    const newInner = innerOf(c.new, type)
    const ref = newInner ?? oldInner
    if (!ref) continue
    const fields = buildFields(SPECS_BY_TYPE[type], oldInner, newInner)
    const status = statusOf(c.status)
    if (status === "modified" && fields.length === 0)
      fields.push(residualChange(type, oldInner, newInner, fmap))
    out.push({
      path: c.path,
      nodeId: c.nodeId,
      type,
      method: type === "request" ? ref.method : undefined,
      name: ref.name ?? "(unnamed)",
      location: locationOf(type, ref, fmap),
      status,
      fields,
      old: c.old,
      new: c.new,
    })
  }
  return out
}

/** Build the entity to write when discarding a single field — `working` with
 * that one field restored to its committed value. Null if nothing to write. */
export function revertFieldEntity(
  change: EntityChange,
  key: string,
): GitEntity | null {
  const working = innerOf(change.new, change.type)
  if (!working) return null
  const reverted = revertField(
    SPECS_BY_TYPE[change.type],
    innerOf(change.old, change.type),
    working,
    key,
  )
  return wrap(change.type, reverted)
}

const SUMMARY_LABEL: Record<string, (n: number) => string> = {
  General: (n) => `${n} ${n === 1 ? "detail" : "details"}`,
  URL: () => "URL",
  "Query Parameters": (n) => `${n} ${n === 1 ? "param" : "params"}`,
  Headers: (n) => `${n} ${n === 1 ? "header" : "headers"}`,
  Body: () => "body",
  Authentication: () => "auth",
  Variables: (n) => `${n} ${n === 1 ? "variable" : "variables"}`,
  Value: (n) => `${n} ${n === 1 ? "value" : "values"}`,
}

/** Plain-language one-liner for the sidebar row. */
export function summarize(change: EntityChange): string {
  if (change.status === "added") return `New ${TYPE_WORD[change.type]}`
  if (change.status === "removed") return "Deleted"
  const counts = new Map<string, number>()
  for (const f of change.fields)
    counts.set(f.group, (counts.get(f.group) ?? 0) + 1)
  const parts = GROUP_ORDER.filter((g) => counts.has(g)).map((g) =>
    SUMMARY_LABEL[g](counts.get(g) ?? 0),
  )
  return parts.join(" · ") || "Edited"
}
