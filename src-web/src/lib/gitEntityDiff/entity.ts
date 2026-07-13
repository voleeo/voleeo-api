import type {
  GitEntity,
  GitEntityChange,
  GitNodeKind,
} from "../../../../packages/types/bindings"
import type { EntityStatus, EntityType } from "./types"

/** Minimal folder shape needed to label an entity's location. */
export interface FolderRef {
  id: string
  name: string
}

const KIND_OF: Record<EntityType, GitNodeKind> = {
  request: "request",
  websocket: "webSocket",
  grpc: "grpc",
  folder: "folder",
  environment: "env",
  cookie: "jar",
  workspace: "workspace",
  snapshot: "snapshot",
}

export const TYPE_WORD: Record<EntityType, string> = {
  request: "request",
  websocket: "WebSocket",
  grpc: "gRPC request",
  folder: "folder",
  environment: "environment",
  cookie: "cookie jar",
  workspace: "workspace",
  snapshot: "snapshot",
}

/** Pull the typed inner struct out of the tagged `GitEntity` union. */
// biome-ignore lint/suspicious/noExplicitAny: the inner entity is re-narrowed by `type`.
export function innerOf(entity: GitEntity | null, type: EntityType): any {
  if (!entity) return null
  switch (type) {
    case "request":
      return entity.request ?? null
    case "websocket":
      return entity.connection ?? null
    case "grpc":
      return entity.grpc ?? null
    case "folder":
      return entity.folder ?? null
    case "environment":
      return entity.environment ?? null
    case "cookie":
      return entity.jar ?? null
    case "workspace":
      return entity.workspace ?? null
    case "snapshot":
      return entity.snapshot ?? null
  }
}

/** Re-wrap an inner struct into the tagged `GitEntity` union for write-back. */
// biome-ignore lint/suspicious/noExplicitAny: inner is the matching entity struct.
export function wrap(type: EntityType, inner: any): GitEntity {
  const e = { kind: KIND_OF[type] } as GitEntity
  switch (type) {
    case "request":
      e.request = inner
      break
    case "websocket":
      e.connection = inner
      break
    case "grpc":
      e.grpc = inner
      break
    case "folder":
      e.folder = inner
      break
    case "environment":
      e.environment = inner
      break
    case "cookie":
      e.jar = inner
      break
    case "workspace":
      e.workspace = inner
      break
    case "snapshot":
      e.snapshot = inner
      break
  }
  return e
}

export function statusOf(change: GitEntityChange["status"]): EntityStatus {
  if (change === "added" || change === "untracked") return "added"
  if (change === "deleted") return "removed"
  return "modified"
}

export function locationOf(
  type: EntityType,
  // biome-ignore lint/suspicious/noExplicitAny: inner entity, type-narrowed by caller.
  inner: any,
  folders: Map<string, string>,
): string {
  if (
    type === "request" ||
    type === "folder" ||
    type === "websocket" ||
    type === "grpc"
  ) {
    const parent = inner?.folderId ? folders.get(inner.folderId) : null
    if (parent) return parent
    if (type === "request") return "Requests"
    if (type === "websocket") return "WebSockets"
    if (type === "grpc") return "gRPC"
    return "Folders"
  }
  if (type === "environment") return "Environments"
  if (type === "cookie") return "Cookies"
  if (type === "snapshot") return "Snapshots"
  return "Workspace"
}
