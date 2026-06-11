import { type RefObject, useCallback, useState } from "react"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { openGitWindow } from "@/layout/gitMenu"
import { useGitStore } from "@/store/git"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import type { CtxMenuState } from "./RequestContextMenu"

export type NodeKind = "request" | "folder" | "websocket" | "grpc"

export interface PendingDelete {
  kind: NodeKind
  id: string
  name: string
}

/** Repo-relative file for a tree node — matches the storage layer's naming. */
function entityPath(kind: NodeKind, id: string): string {
  if (kind === "request") return `req_${id}.yaml`
  if (kind === "websocket") return `ws_${id}.yaml`
  if (kind === "grpc") return `grpc_${id}.yaml`
  return `folder_${id}.yaml`
}

/** Walk up the DOM from `target` to the nearest tree row's node id/kind. */
function findNodeTarget(
  target: EventTarget | null,
): { id: string; kind: NodeKind } | null {
  let el = target as HTMLElement | null
  while (el) {
    const id = el.dataset?.nodeId
    const kind = el.dataset?.nodeKind
    if (
      id &&
      (kind === "request" ||
        kind === "folder" ||
        kind === "websocket" ||
        kind === "grpc")
    )
      return { id, kind }
    el = el.parentElement
  }
  return null
}

/** Create / rename / duplicate / delete handlers for tree items, plus the
 *  context-menu and delete-confirmation state they drive. Store data and
 *  actions are read fresh via `getState()` at call time. */
export function useTreeActions(
  activeWorkspaceId: string | null,
  treeRef: RefObject<ApiRequestTreeHandle | null>,
) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pendingDeleteBatch, setPendingDeleteBatch] = useState<string[] | null>(
    null,
  )
  const [pendingRollback, setPendingRollback] = useState<PendingDelete | null>(
    null,
  )

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const node = findNodeTarget(e.target)
    setCtxMenu(
      node
        ? { kind: node.kind, id: node.id, x: e.clientX, y: e.clientY }
        : { kind: "workspace", x: e.clientX, y: e.clientY },
    )
  }

  // Queue inline-rename for the freshly-created entity. Same pattern
  // NewItemButton uses — the tree picks it up on next render.
  function queueRenameFor(id: string | undefined) {
    if (id) useTreeUiStore.getState().requestRename(id)
  }

  async function handleCreateRequest(folderId?: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    if (folderId) useTreeUiStore.getState().ensureFoldersOpen([folderId])
    const created = await useRequestStore
      .getState()
      .createRequest(activeWorkspaceId, folderId ? { folderId } : undefined)
    queueRenameFor(created?.id)
  }

  async function handleCreateFolder(folderId?: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    if (folderId) useTreeUiStore.getState().ensureFoldersOpen([folderId])
    const created = await useRequestStore
      .getState()
      .createFolder(activeWorkspaceId, folderId ? { folderId } : undefined)
    queueRenameFor(created?.id)
  }

  async function handleCreateConnection(folderId?: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    if (folderId) useTreeUiStore.getState().ensureFoldersOpen([folderId])
    const created = await useRequestStore
      .getState()
      .createConnection(activeWorkspaceId, folderId ? { folderId } : undefined)
    queueRenameFor(created?.id)
  }

  async function handleCreateGrpc(folderId?: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    if (folderId) useTreeUiStore.getState().ensureFoldersOpen([folderId])
    const created = await useRequestStore
      .getState()
      .createGrpc(activeWorkspaceId, folderId ? { folderId } : undefined)
    queueRenameFor(created?.id)
  }

  function handleRename(id: string) {
    setCtxMenu(null)
    treeRef.current?.startRename(id)
  }

  function handleDuplicate(kind: NodeKind, id: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    const s = useRequestStore.getState()
    if (kind === "request") void s.duplicateRequest(activeWorkspaceId, id)
    else if (kind === "websocket")
      void s.duplicateConnection(activeWorkspaceId, id)
    else if (kind === "grpc") void s.duplicateGrpc(activeWorkspaceId, id)
    else void s.duplicateFolder(activeWorkspaceId, id)
  }

  function handleDelete(kind: NodeKind, id: string) {
    setCtxMenu(null)
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

  function entityName(kind: NodeKind, id: string): string {
    const { requests, folders, connections, grpcRequests } =
      useRequestStore.getState()
    if (kind === "request")
      return requests.find((r) => r.id === id)?.name ?? "this request"
    if (kind === "websocket")
      return connections.find((c) => c.id === id)?.name ?? "this connection"
    if (kind === "grpc")
      return grpcRequests.find((g) => g.id === id)?.name ?? "this gRPC request"
    return folders.find((f) => f.id === id)?.name ?? "this folder"
  }

  function handleRollback(kind: NodeKind, id: string) {
    setCtxMenu(null)
    setPendingRollback({ kind, id, name: entityName(kind, id) })
  }

  function confirmRollback() {
    if (!pendingRollback) return
    const { kind, id } = pendingRollback
    void useGitStore.getState().rollback(entityPath(kind, id))
    setPendingRollback(null)
    treeRef.current?.focus()
  }

  function handleShowHistory(kind: NodeKind, id: string) {
    setCtxMenu(null)
    if (!activeWorkspaceId) return
    void openGitWindow(
      activeWorkspaceId,
      "history",
      entityPath(kind, id),
      entityName(kind, id),
    )
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
    ctxMenu,
    closeCtxMenu,
    handleContextMenu,
    handleCreateRequest,
    handleCreateFolder,
    handleCreateConnection,
    handleCreateGrpc,
    handleRename,
    handleDuplicate,
    handleDelete,
    handleDeleteIds,
    handleRollback,
    handleShowHistory,
    pendingDelete,
    pendingDeleteBatch,
    pendingRollback,
    confirmDelete,
    confirmDeleteBatch,
    confirmRollback,
    cancelDelete: () => setPendingDelete(null),
    cancelDeleteBatch: () => setPendingDeleteBatch(null),
    cancelRollback: () => setPendingRollback(null),
    isBlocking:
      ctxMenu != null ||
      pendingDelete != null ||
      pendingDeleteBatch != null ||
      pendingRollback != null,
  }
}
