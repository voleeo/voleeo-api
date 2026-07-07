import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { ApiRequestTree } from "@/components/ApiRequestTree"
import { getAncestorFolderIds } from "@/components/ApiRequestTree/treeUtils"
import { SearchField } from "@/components/SearchField"
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"
import { DeleteDialogs } from "./DeleteDialogs"
import { FilteredResults } from "./FilteredResults"
import { RequestContextMenu } from "./RequestContextMenu"
import {
  collapseAll,
  expandAll,
  focusActive,
  RunningFooter,
} from "./RunningFooter"
import { useTreeActions } from "./useTreeActions"

export function RequestTreePane() {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const {
    tree,
    requests,
    folders,
    activeRequestId,
    load,
    setActiveRequest,
    moveItems,
  } = useRequestStore(
    useShallow((s) => ({
      tree: s.tree,
      requests: s.requests,
      folders: s.folders,
      activeRequestId: s.activeRequestId,
      load: s.load,
      setActiveRequest: s.setActiveRequest,
      moveItems: s.moveItems,
    })),
  )

  const [query, setQuery] = useState("")
  const [searchVisible, setSearchVisible] = useState(false)
  const treeRef = useRef<ApiRequestTreeHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const actions = useTreeActions(activeWorkspaceId, treeRef)

  const revealSearch = useCallback(() => {
    setSearchVisible(true)
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (searchVisible) searchInputRef.current?.focus()
  }, [searchVisible])

  useKeydown(SHORTCUTS.SEARCH, revealSearch)
  useKeydown(SHORTCUTS.FOCUS_ACTIVE, focusActive)
  useKeydown(SHORTCUTS.COLLAPSE_ALL, collapseAll)
  useKeydown(SHORTCUTS.EXPAND_ALL, expandAll)

  useEffect(() => {
    if (activeWorkspaceId) load(activeWorkspaceId)
  }, [activeWorkspaceId, load])

  // Switching workspaces clears the search — the prior query (and its results) are meaningless in the new tree.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on workspace change
  useEffect(() => {
    setQuery("")
    setSearchVisible(false)
  }, [activeWorkspaceId])

  const filteredRequests = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return requests.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q),
    )
  }, [query, requests])

  function handlePaneKeyDown(e: React.KeyboardEvent) {
    if (actions.isBlocking) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
    const target = e.target as HTMLElement
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return
    }
    e.preventDefault()
    setQuery((q) => q + e.key)
    revealSearch()
  }

  // The field hides itself when it loses focus with nothing entered.
  function handleSearchBlur() {
    if (query.trim() === "") setSearchVisible(false)
  }

  function handleSelectFiltered(requestId: string, folderId: string | null) {
    const ancestorIds = getAncestorFolderIds(folders, folderId)
    useTreeUiStore.getState().ensureFoldersOpen(ancestorIds)
    setActiveRequest(requestId)
    setQuery("")
    setSearchVisible(false)
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      onContextMenu={actions.handleContextMenu}
      onKeyDown={handlePaneKeyDown}
    >
      {searchVisible && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <SearchField
            value={query}
            onChange={setQuery}
            inputRef={searchInputRef}
            onBlur={handleSearchBlur}
            onClear={() => setSearchVisible(false)}
            alwaysShowClear
          />
        </div>
      )}

      <div className="flex-1 overflow-auto py-1.5">
        {query.trim() ? (
          <FilteredResults
            requests={filteredRequests}
            folders={folders}
            activeRequestId={activeRequestId}
            onSelect={handleSelectFiltered}
          />
        ) : (
          <ApiRequestTree
            workspaceId={activeWorkspaceId ?? ""}
            tree={tree}
            activeRequestId={activeRequestId}
            onSelectRequest={setActiveRequest}
            onMoveItems={(updates) =>
              moveItems(activeWorkspaceId ?? "", updates)
            }
            onDeleteIds={actions.handleDeleteIds}
            handleRef={treeRef}
          />
        )}
      </div>

      <RunningFooter />

      {actions.ctxMenu && (
        <RequestContextMenu
          state={actions.ctxMenu}
          onClose={actions.closeCtxMenu}
          onCreateRequest={actions.handleCreateRequest}
          onCreateGraphql={actions.handleCreateGraphql}
          onCreateFolder={actions.handleCreateFolder}
          onCreateConnection={actions.handleCreateConnection}
          onCreateGrpc={actions.handleCreateGrpc}
          onRename={actions.handleRename}
          onDuplicate={actions.handleDuplicate}
          onDelete={actions.handleDelete}
          onRollback={actions.handleRollback}
          onShowHistory={actions.handleShowHistory}
        />
      )}
      <DeleteDialogs
        pendingDelete={actions.pendingDelete}
        pendingDeleteBatch={actions.pendingDeleteBatch}
        onConfirmDelete={actions.confirmDelete}
        onCancelDelete={actions.cancelDelete}
        onConfirmBatch={actions.confirmDeleteBatch}
        onCancelBatch={actions.cancelDeleteBatch}
      />
      {actions.pendingRollback && (
        <ConfirmationDialog
          title="Rollback changes?"
          icon="warning"
          description={
            <>
              Revert <code>{actions.pendingRollback.name}</code> to its last
              committed version.{" "}
              {actions.pendingRollback.target === "folder-children"
                ? "Uncommitted changes to the requests and folders inside it will be discarded."
                : actions.pendingRollback.target === "folder"
                  ? "Uncommitted changes to this folder's own params, auth, and variables will be discarded — its contents are left untouched."
                  : "Uncommitted changes to this request will be discarded."}
            </>
          }
          confirmLabel="Rollback"
          confirmVariant="destructive"
          onConfirm={actions.confirmRollback}
          onCancel={actions.cancelRollback}
        />
      )}
    </div>
  )
}
