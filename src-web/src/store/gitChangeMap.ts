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

/** Parent of a DELETED node, from the backend's HEAD lookup — deleted entities
 *  are gone from the live lists, so `parentMap` can't know their folder. */
function deletedParentMap(files: GitFileChange[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const f of files) if (f.nodeId && f.parentId) m[f.nodeId] = f.parentId
  return m
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
  const deletedParentOf = deletedParentMap(files)
  // Live parent first; fall back to the HEAD-resolved parent for deleted nodes.
  const resolveParent = (id: string): string | null =>
    parentOf[id] ?? deletedParentOf[id] ?? null
  const byNode: Record<string, GitChange> = { ...own }
  const folderDescendantChanged = new Set<string>()
  for (const [nodeId, change] of Object.entries(own)) {
    let p = resolveParent(nodeId)
    while (p) {
      byNode[p] = byNode[p] ? worse(byNode[p], change) : change
      folderDescendantChanged.add(p)
      p = resolveParent(p)
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
  const deletedParentOf = deletedParentMap(files)
  const resolveParent = (id: string): string | null =>
    parentOf[id] ?? deletedParentOf[id] ?? null
  const isUnder = (id: string) => {
    let p = resolveParent(id)
    while (p) {
      if (p === folderId) return true
      p = resolveParent(p)
    }
    return false
  }

  return files
    .filter((f) => f.nodeId && f.nodeId !== folderId && isUnder(f.nodeId))
    .map((f) => f.path)
}
