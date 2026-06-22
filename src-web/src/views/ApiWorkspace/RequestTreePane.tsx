import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { ApiRequestTreeHandle } from "@/components/ApiRequestTree"
import { ApiRequestTree } from "@/components/ApiRequestTree"
import { getAncestorFolderIds } from "@/components/ApiRequestTree/treeUtils"
import { Glyph } from "@/components/Glyph"
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"
import { DeleteDialogs } from "./DeleteDialogs"
import { FilteredResults } from "./FilteredResults"
import { RequestContextMenu } from "./RequestContextMenu"
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

  useEffect(() => {
    if (activeWorkspaceId) load(activeWorkspaceId)
  }, [activeWorkspaceId, load])

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
          <div className="flex items-center gap-1.5 px-2 py-[5px] rounded-[4px] bg-subtle">
            <Glyph kind="search" size={12} color="var(--base04)" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={handleSearchBlur}
              placeholder="Search"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent border-none outline-none font-mono text-[0.857rem] text-fg placeholder:text-muted"
            />
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setSearchVisible(false)
              }}
              className="flex items-center justify-center w-4 h-4 rounded-[2px] border-0 bg-transparent outline-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            >
              <Glyph kind="x" size={10} color="var(--base04)" />
            </button>
          </div>
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
              {actions.pendingRollback.target === "folder-requests"
                ? "Uncommitted changes to requests in this folder will be discarded."
                : actions.pendingRollback.target === "folder"
                  ? "Uncommitted changes to this folder will be discarded."
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
