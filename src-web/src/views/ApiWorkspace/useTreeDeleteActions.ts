import { type RefObject, useState } from "react"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { flattenVisible } from "@/components/ApiRequestTree/treeUtils"
import { useRequestStore } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { useTreeUiStore } from "@/store/treeUi"
import {
  entityName,
  type NodeKind,
  type PendingDelete,
} from "./treeActionsShared"

/** The row to land on after deleting `id`: the previous visible node (never a
 *  descendant, since children sort after their parent), else the first node
 *  past the deleted item's subtree. Null when nothing else remains. */
function neighborAfterDelete(id: string): string | null {
  const closed = useTreeUiStore.getState().closedFolderIds
  const flat = flattenVisible(
    useRequestStore.getState().tree,
    (fid) => !closed.includes(fid),
    (rid) => useSnapshotsStore.getState().byRequest[rid],
  )
  const i = flat.findIndex((n) => n.id === id)
  if (i === -1) return null
  if (i > 0) return flat[i - 1].id
  // Nothing above — skip the deleted node's subtree, then take the next row.
  const subtree = new Set([id])
  for (let j = i + 1; j < flat.length; j++) {
    if (flat[j].parentId && subtree.has(flat[j].parentId as string)) {
      subtree.add(flat[j].id)
      continue
    }
    return flat[j].id
  }
  return null
}

function isSnapshotId(id: string): boolean {
  const byRequest = useSnapshotsStore.getState().byRequest
  for (const list of Object.values(byRequest)) {
    if (list.some((p) => p.id === id)) return true
  }
  return false
}

function wasActive(id: string): boolean {
  const s = useRequestStore.getState()
  return (
    s.activeRequestId === id ||
    s.activeFolderId === id ||
    s.activeConnectionId === id ||
    s.activeGrpcId === id ||
    s.activeSnapshotId === id
  )
}

function activateNode(wsId: string, id: string): void {
  const s = useRequestStore.getState()
  if (s.requests.some((r) => r.id === id)) s.setActiveRequest(id)
  else if (s.folders.some((f) => f.id === id)) s.setActiveFolder(id)
  else if (s.connections.some((c) => c.id === id)) s.setActiveConnection(id)
  else if (s.grpcRequests.some((g) => g.id === id)) s.setActiveGrpc(id)
  else {
    s.setActiveSnapshot(id)
    void useSnapshotsStore.getState().openSnapshot(wsId, id)
  }
}

/** Single + batch delete with their confirmation-dialog state. */
export function useTreeDeleteActions(
  activeWorkspaceId: string | null,
  treeRef: RefObject<ApiRequestTreeHandle | null>,
  closeMenu: () => void,
) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pendingDeleteBatch, setPendingDeleteBatch] = useState<string[] | null>(
    null,
  )

  function handleDelete(kind: NodeKind, id: string) {
    closeMenu()
    setPendingDelete({ kind, id, name: entityName(kind, id) })
  }

  function confirmDelete() {
    if (!pendingDelete || !activeWorkspaceId) return
    const { kind, id } = pendingDelete
    const wsId = activeWorkspaceId
    const next = neighborAfterDelete(id)
    const wasActiveNode = wasActive(id)
    const s = useRequestStore.getState()
    if (kind === "request") void s.deleteRequest(wsId, id)
    else if (kind === "websocket") void s.deleteConnection(wsId, id)
    else if (kind === "grpc") void s.deleteGrpc(wsId, id)
    else void s.deleteFolder(wsId, id)
    setPendingDelete(null)
    if (next) {
      useTreeUiStore.getState().setSelection([next], next)
      useTreeUiStore.getState().setFocusedNodeId(next)
      if (wasActiveNode) activateNode(wsId, next)
    }
    treeRef.current?.focus()
  }

  // Multi-delete from the tree. A single id reuses the single-row dialog
  // (already named/typed); multiple ids open the batch dialog.
  function handleDeleteIds(ids: string[]) {
    if (!activeWorkspaceId || ids.length === 0) return
    if (ids.length === 1 && !isSnapshotId(ids[0])) {
      const id = ids[0]
      const { requests, folders, connections, grpcRequests } =
        useRequestStore.getState()
      const folder = folders.find((f) => f.id === id)
      if (folder) {
        setPendingDelete({ kind: "folder", id, name: folder.name })
        return
      }
      const request = requests.find((r) => r.id === id)
      if (request) {
        setPendingDelete({ kind: "request", id, name: request.name })
        return
      }
      const connection = connections.find((c) => c.id === id)
      if (connection) {
        setPendingDelete({ kind: "websocket", id, name: connection.name })
        return
      }
      const grpc = grpcRequests.find((g) => g.id === id)
      if (grpc) setPendingDelete({ kind: "grpc", id, name: grpc.name })
      return
    }
    setPendingDeleteBatch(ids)
  }

  function confirmDeleteBatch() {
    if (!pendingDeleteBatch || !activeWorkspaceId) return
    const ids = pendingDeleteBatch
    const wsId = activeWorkspaceId
    setPendingDeleteBatch(null)

    void (async () => {
      const {
        requests,
        folders,
        connections,
        grpcRequests,
        deleteFolder,
        deleteRequest,
        deleteConnection,
        deleteGrpc,
      } = useRequestStore.getState()
      const folderIds = ids.filter((id) => folders.some((f) => f.id === id))
      const requestIds = ids.filter((id) => requests.some((r) => r.id === id))
      const connectionIds = ids.filter((id) =>
        connections.some((c) => c.id === id),
      )
      const grpcIds = ids.filter((id) => grpcRequests.some((g) => g.id === id))
      const snapshotIds = ids.filter(isSnapshotId)
      for (const id of folderIds) await deleteFolder(wsId, id).catch(() => {})
      for (const id of requestIds) await deleteRequest(wsId, id).catch(() => {})
      for (const id of connectionIds)
        await deleteConnection(wsId, id).catch(() => {})
      for (const id of grpcIds) await deleteGrpc(wsId, id).catch(() => {})
      const deleteSnapshot = useSnapshotsStore.getState().deleteSnapshot
      for (const id of snapshotIds)
        await deleteSnapshot(wsId, id).catch(() => {})
    })()

    treeRef.current?.focus()
  }

  return {
    pendingDelete,
    pendingDeleteBatch,
    handleDelete,
    handleDeleteIds,
    confirmDelete,
    confirmDeleteBatch,
    cancelDelete: () => setPendingDelete(null),
    cancelDeleteBatch: () => setPendingDeleteBatch(null),
  }
}
