import type {
  GitEntity,
  GitNodeKind,
} from "../../../../packages/types/bindings"

/** Field groups, in display order, shared by both screens (mirrors the design). */
export const GROUP_ORDER = [
  "General",
  "URL",
  "Query Parameters",
  "Headers",
  "Metadata",
  "Body",
  "Query",
  "Variables",
  "Message",
  "Authentication",
  "DNS Overrides",
  "Value",
] as const
export type FieldGroup = (typeof GROUP_ORDER)[number]

/** The entity buckets shown in the sidebar, in order. */
export type EntityType =
  | "request"
  | "websocket"
  | "grpc"
  | "folder"
  | "environment"
  | "cookie"
  | "workspace"

export const TYPE_GROUPS: { type: EntityType; label: string }[] = [
  { type: "request", label: "Requests" },
  { type: "websocket", label: "WebSockets" },
  { type: "grpc", label: "gRPC" },
  { type: "folder", label: "Folders" },
  { type: "environment", label: "Environments" },
  { type: "cookie", label: "Cookies" },
  { type: "workspace", label: "Workspace" },
]

export function nodeKindToType(kind: GitNodeKind): EntityType | null {
  switch (kind) {
    case "request":
      return "request"
    case "webSocket":
      return "websocket"
    case "grpc":
      return "grpc"
    case "folder":
      return "folder"
    case "env":
      return "environment"
    case "jar":
      return "cookie"
    case "workspace":
      return "workspace"
    default:
      return null
  }
}

export type FieldKind = "added" | "removed" | "changed"

/** One semantic edit inside an entity — the unit of the Review-changes detail. */
export interface FieldChange {
  group: FieldGroup
  label?: string
  kind: FieldKind
  before?: string
  after?: string
  secret?: boolean
  key?: string
}

export type EntityStatus = "added" | "modified" | "removed"

export interface EntityChange {
  path: string
  nodeId: string | null
  type: EntityType
  method?: string
  name: string
  location: string
  status: EntityStatus
  fields: FieldChange[]
  old: GitEntity | null
  new: GitEntity | null
}

/** One conflicting field — a quiet choice between your value and theirs. */
export interface ConflictField {
  id: string
  group: FieldGroup
  label?: string
  yours: string
  theirs: string
  canBoth?: boolean
  secret?: boolean
}

export type Choice = "yours" | "theirs" | "both"

export interface ConflictEntity {
  path: string
  nodeId: string | null
  type: EntityType
  method?: string
  name: string
  location: string
  conflicts: ConflictField[]
  wholeEntity: boolean
  base: GitEntity | null
  ours: GitEntity | null
  theirs: GitEntity | null
}
