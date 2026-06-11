import type {
  ApiFolder,
  GitChange,
  GitFileChange,
  GrpcRequest,
  HttpRequest,
  WsConnection,
} from "../../../packages/types/bindings"

/** Higher rank = more severe; wins when a node has several change kinds. */
const RANK: Record<GitChange, number> = {
  conflicted: 5,
  deleted: 4,
  renamed: 3,
  modified: 3,
  added: 2,
  untracked: 1,
}

function worse(a: GitChange, b: GitChange): GitChange {
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * Map node id → change for O(1) tree lookups, rolling each item's change up into
 * its ancestor folders so a collapsed folder still shows a dot. Covers requests,
 * WebSocket connections, and gRPC requests.
 */
export function buildChangeMap(
  files: GitFileChange[],
  requests: HttpRequest[],
  folders: ApiFolder[],
  connections: WsConnection[] = [],
  grpcRequests: GrpcRequest[] = [],
): Record<string, GitChange> {
  const own: Record<string, GitChange> = {}
  for (const f of files) {
    if (!f.nodeId) continue
    const prev = own[f.nodeId]
    own[f.nodeId] = prev ? worse(prev, f.change) : f.change
  }

  const parentOf: Record<string, string | null> = {}
  for (const r of requests) parentOf[r.id] = r.folderId ?? null
  for (const c of connections) parentOf[c.id] = c.folderId ?? null
  for (const g of grpcRequests) parentOf[g.id] = g.folderId ?? null
  for (const fo of folders) parentOf[fo.id] = fo.folderId ?? null

  const map: Record<string, GitChange> = { ...own }
  for (const [nodeId, change] of Object.entries(own)) {
    let p = parentOf[nodeId] ?? null
    while (p) {
      map[p] = map[p] ? worse(map[p], change) : change
      p = parentOf[p] ?? null
    }
  }
  return map
}
