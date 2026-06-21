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

function parentMap(
  requests: HttpRequest[],
  folders: ApiFolder[],
  connections: WsConnection[],
  grpcRequests: GrpcRequest[],
): Record<string, string | null> {
  const parentOf: Record<string, string | null> = {}
  for (const r of requests) parentOf[r.id] = r.folderId ?? null
  for (const c of connections) parentOf[c.id] = c.folderId ?? null
  for (const g of grpcRequests) parentOf[g.id] = g.folderId ?? null
  for (const fo of folders) parentOf[fo.id] = fo.folderId ?? null
  return parentOf
}

export interface ChangeMaps {
  byNode: Record<string, GitChange>
  ownByNode: Record<string, GitChange>
  folderDescendantChanged: Set<string>
}

export function buildChangeMap(
  files: GitFileChange[],
  requests: HttpRequest[],
  folders: ApiFolder[],
  connections: WsConnection[] = [],
  grpcRequests: GrpcRequest[] = [],
): ChangeMaps {
  const own: Record<string, GitChange> = {}
  for (const f of files) {
    if (!f.nodeId) continue
    const prev = own[f.nodeId]
    own[f.nodeId] = prev ? worse(prev, f.change) : f.change
  }

  const parentOf = parentMap(requests, folders, connections, grpcRequests)
  const folderIds = new Set(folders.map((f) => f.id))

  const byNode: Record<string, GitChange> = { ...own }
  const folderDescendantChanged = new Set<string>()
  for (const [nodeId, change] of Object.entries(own)) {
    const isRequestLike = !folderIds.has(nodeId)
    let p = parentOf[nodeId] ?? null
    while (p) {
      byNode[p] = byNode[p] ? worse(byNode[p], change) : change
      if (isRequestLike) folderDescendantChanged.add(p)
      p = parentOf[p] ?? null
    }
  }
  return { byNode, ownByNode: own, folderDescendantChanged }
}

export function changedPathsUnderFolder(
  folderId: string,
  files: GitFileChange[],
  requests: HttpRequest[],
  folders: ApiFolder[],
  connections: WsConnection[] = [],
  grpcRequests: GrpcRequest[] = [],
): string[] {
  const parentOf = parentMap(requests, folders, connections, grpcRequests)
  const folderIds = new Set(folders.map((f) => f.id))
  const isUnder = (id: string) => {
    let p = parentOf[id] ?? null
    while (p) {
      if (p === folderId) return true
      p = parentOf[p] ?? null
    }
    return false
  }
  return files
    .filter(
      (f) =>
        f.nodeId &&
        f.nodeId !== folderId &&
        !folderIds.has(f.nodeId) &&
        isUnder(f.nodeId),
    )
    .map((f) => f.path)
}
