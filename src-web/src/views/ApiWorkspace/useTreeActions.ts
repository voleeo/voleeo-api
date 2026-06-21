import { type RefObject, useCallback, useState } from "react"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { openGitWindow } from "@/layout/gitMenu"
import { useGitStore } from "@/store/git"
import { changedPathsUnderFolder } from "@/store/gitChangeMap"
import { useRequestStore } from "@/store/requests"
import type { CtxMenuState, RollbackTarget } from "./RequestContextMenu"
import { entityName, entityPath, type NodeKind } from "./treeActionsShared"
import { useTreeCreateActions } from "./useTreeCreateActions"
import { useTreeDeleteActions } from "./useTreeDeleteActions"

export type { NodeKind, PendingDelete } from "./treeActionsShared"

export interface PendingRollback {
  target: RollbackTarget
  id: string
  name: string
}

/** Both folder rollback targets resolve to the folder node for naming/paths. */
function rollbackNodeKind(target: RollbackTarget): NodeKind {
  return target === "request" ? "request" : "folder"
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

/** Create / rename / duplicate / delete / rollback handlers for tree items,
 *  plus the context-menu and confirmation state they drive. Create and delete
 *  concerns live in dedicated hooks; this orchestrates them. */
export function useTreeActions(
  activeWorkspaceId: string | null,
  treeRef: RefObject<ApiRequestTreeHandle | null>,
) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [pendingRollback, setPendingRollback] =
    useState<PendingRollback | null>(null)

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])
  const create = useTreeCreateActions(activeWorkspaceId, closeCtxMenu)
  const del = useTreeDeleteActions(activeWorkspaceId, treeRef, closeCtxMenu)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const node = findNodeTarget(e.target)
    setCtxMenu(
      node
        ? { kind: node.kind, id: node.id, x: e.clientX, y: e.clientY }
        : { kind: "workspace", x: e.clientX, y: e.clientY },
    )
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

  function handleRollback(target: RollbackTarget, id: string) {
    setCtxMenu(null)
    const name = entityName(rollbackNodeKind(target), id)
    setPendingRollback({ target, id, name })
  }

  function confirmRollback() {
    if (!pendingRollback) return
    const { target, id } = pendingRollback
    const git = useGitStore.getState()
    if (target === "folder-requests") {
      const { requests, folders, connections, grpcRequests } =
        useRequestStore.getState()
      void git.rollback(
        changedPathsUnderFolder(
          id,
          git.files,
          requests,
          folders,
          connections,
          grpcRequests,
        ),
      )
    } else {
      void git.rollback(entityPath(rollbackNodeKind(target), id))
    }
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

  return {
    ctxMenu,
    closeCtxMenu,
    handleContextMenu,
    ...create,
    handleRename,
    handleDuplicate,
    ...del,
    handleRollback,
    handleShowHistory,
    pendingRollback,
    confirmRollback,
    cancelRollback: () => setPendingRollback(null),
    isBlocking:
      ctxMenu != null ||
      del.pendingDelete != null ||
      del.pendingDeleteBatch != null ||
      pendingRollback != null,
  }
}
