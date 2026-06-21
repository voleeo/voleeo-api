import { type RefObject, useState } from "react"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { useRequestStore } from "@/store/requests"
import {
  entityName,
  type NodeKind,
  type PendingDelete,
} from "./treeActionsShared"

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
    const s = useRequestStore.getState()
    if (kind === "request") void s.deleteRequest(activeWorkspaceId, id)
    else if (kind === "websocket")
      void s.deleteConnection(activeWorkspaceId, id)
    else if (kind === "grpc") void s.deleteGrpc(activeWorkspaceId, id)
    else void s.deleteFolder(activeWorkspaceId, id)
    setPendingDelete(null)
    treeRef.current?.focus()
  }

  // Multi-delete from the tree. A single id reuses the single-row dialog
  // (already named/typed); multiple ids open the batch dialog.
  function handleDeleteIds(ids: string[]) {
    if (!activeWorkspaceId || ids.length === 0) return
    if (ids.length === 1) {
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
      for (const id of folderIds) await deleteFolder(wsId, id).catch(() => {})
      for (const id of requestIds) await deleteRequest(wsId, id).catch(() => {})
      for (const id of connectionIds)
        await deleteConnection(wsId, id).catch(() => {})
      for (const id of grpcIds) await deleteGrpc(wsId, id).catch(() => {})
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
