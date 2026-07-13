import type React from "react"
import { useEffect, useImperativeHandle, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Row } from "@/components/ApiRequestTree/TreeRow"
import { flattenVisible, getId } from "@/components/ApiRequestTree/treeUtils"
import { Ctx } from "@/components/ApiRequestTree/types"
import { useDrag } from "@/components/ApiRequestTree/useDrag"
import { useFolderState } from "@/components/ApiRequestTree/useFolderState"
import { useKeyNav } from "@/components/ApiRequestTree/useKeyNav"
import { useGitStore } from "@/store/git"
import type { MoveItemUpdate, TreeNode } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { useTreeUiStore } from "@/store/treeUi"
import { useWebsocketStore } from "@/store/websocket"
import { usePruneSelection } from "./usePruneSelection"
import { useRequestStatuses } from "./useRequestStatuses"
import { useTreeKeyboard } from "./useTreeKeyboard"

export interface ApiRequestTreeHandle {
  startRename: (id: string) => void
  focus: () => void
}

interface Props {
  workspaceId: string
  tree: TreeNode[]
  activeRequestId: string | null
  onSelectRequest: (id: string) => void
  onMoveItems: (updates: MoveItemUpdate[]) => Promise<void>
  onDeleteIds?: (ids: string[]) => void
  handleRef?: React.Ref<ApiRequestTreeHandle>
}

export function ApiRequestTree({
  workspaceId,
  tree,
  activeRequestId,
  onSelectRequest,
  onMoveItems,
  onDeleteIds,
  handleRef,
}: Props) {
  const {
    renameRequest,
    renameFolder,
    renameConnection,
    renameGrpc,
    setActiveConnection,
    setActiveGrpc,
  } = useRequestStore(
    useShallow((s) => ({
      renameRequest: s.renameRequest,
      renameFolder: s.renameFolder,
      renameConnection: s.renameConnection,
      renameGrpc: s.renameGrpc,
      setActiveConnection: s.setActiveConnection,
      setActiveGrpc: s.setActiveGrpc,
    })),
  )
  const drag = useDrag(tree, onMoveItems)
  const folderState = useFolderState(workspaceId)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const lastStatuses = useRequestStatuses(workspaceId, tree)
  const gitChangeByNode = useGitStore((s) => s.changeByNode)
  const wsStatuses = useWebsocketStore((s) => s.status)

  // Container ref so we can pull keyboard focus back to the tree whenever the
  // user clicks a row OR a confirmation dialog closes. Without this, focus
  // strands on the editor / `document.body` and subsequent Delete / Arrow
  // presses don't reach the tree's keydown handler.
  const containerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(
    handleRef,
    () => ({
      startRename: setRenamingId,
      focus: () => containerRef.current?.focus({ preventScroll: true }),
    }),
    [],
  )

  const pendingRenameId = useTreeUiStore((s) => s.pendingRenameId)
  useEffect(() => {
    if (!pendingRenameId) return
    const visible = flattenVisible(
      tree,
      folderState.isFolderOpen,
      (rid) => useSnapshotsStore.getState().byRequest[rid],
    )
    if (visible.some((n) => n.id === pendingRenameId)) {
      setRenamingId(pendingRenameId)
      useTreeUiStore.getState().consumePendingRename()
    }
  }, [pendingRenameId, tree, folderState])

  const focusedNodeId = useTreeUiStore((s) => s.focusedNodeId)
  useEffect(() => {
    if (!focusedNodeId) return
    containerRef.current
      ?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(focusedNodeId)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" })
  }, [focusedNodeId])

  usePruneSelection(tree)

  // Open the item in its pane, exactly as a click would. Shared by Space
  // (open only) and Enter/double-click (open + inline rename).
  const openNode = (
    id: string,
    kind: "folder" | "request" | "websocket" | "grpc" | "snapshot",
  ) => {
    if (kind === "snapshot") {
      useRequestStore.getState().setActiveSnapshot(id)
      useSnapshotsStore.getState().openSnapshot(workspaceId, id)
    } else if (kind === "request") onSelectRequest(id)
    else if (kind === "websocket") setActiveConnection(id)
    else if (kind === "grpc") setActiveGrpc(id)
    else useRequestStore.getState().setActiveFolder(id)
  }

  const onEnterAction = (
    id: string,
    kind: "folder" | "request" | "websocket" | "grpc" | "snapshot",
  ) => {
    openNode(id, kind)
    setRenamingId(id)
  }

  const commitRename = (
    id: string,
    kind: "folder" | "request" | "websocket" | "grpc" | "snapshot",
    name: string,
  ) => {
    const trimmed = name.trim()
    setRenamingId(null)
    if (!trimmed) return
    if (kind === "request") renameRequest(workspaceId, id, trimmed)
    else if (kind === "websocket") renameConnection(workspaceId, id, trimmed)
    else if (kind === "grpc") renameGrpc(workspaceId, id, trimmed)
    else if (kind === "snapshot")
      useSnapshotsStore.getState().renameSnapshot(workspaceId, id, trimmed)
    else renameFolder(workspaceId, id, trimmed)
  }

  const cancelRename = () => setRenamingId(null)

  const keyNav = useKeyNav(
    tree,
    folderState.isFolderOpen,
    folderState.toggleFolder,
    onEnterAction,
    openNode,
  )

  const handleKeyDown = useTreeKeyboard({
    workspaceId,
    keyNav,
    renamingId,
    onDeleteIds,
  })

  return (
    <Ctx.Provider
      value={{
        ...drag,
        ...folderState,
        ...keyNav,
        onEnterAction,
        renamingId,
        commitRename,
        cancelRename,
        refocusTree: () => containerRef.current?.focus({ preventScroll: true }),
        lastStatuses,
        gitChangeByNode,
        wsStatuses,
      }}
    >
      {/* tabIndex makes the container focusable so keyboard events reach it */}
      <div
        ref={containerRef}
        className="min-h-full min-w-[100px] select-none outline-none"
        tabIndex={0}
        // Re-focus the tree on mouseup so a click that selected a request
        // (which also opens it in the editor) doesn't strand focus there.
        // Pressed-then-released over a row → focus back on the tree, so
        // Delete / Backspace hits handleDeleteSelection. But never steal focus
        // from an inline rename input — that blurs it and commits mid-edit, so a
        // click to place the caret would exit edit mode.
        onMouseUp={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea")) return
          containerRef.current?.focus({ preventScroll: true })
        }}
        onKeyDown={handleKeyDown}
      >
        {tree.length === 0 ? (
          <div className="px-3.5 py-4 font-mono text-[0.714rem] text-muted text-center">
            No requests yet
          </div>
        ) : (
          tree.map((node) => (
            <Row
              key={getId(node)}
              node={node}
              depth={0}
              activeRequestId={activeRequestId}
              onSelectRequest={onSelectRequest}
            />
          ))
        )}
      </div>
    </Ctx.Provider>
  )
}
