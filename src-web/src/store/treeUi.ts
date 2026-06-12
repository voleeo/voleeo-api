import { create } from "zustand"
import { FolderIdsSchema } from "@/lib/schemas"

function storageKey(workspaceId: string) {
  return `voleeo:tree:closed:${workspaceId}`
}

function loadClosed(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    return raw ? FolderIdsSchema.parse(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function saveClosed(workspaceId: string, ids: string[]) {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(ids))
  } catch {}
}

interface TreeUiStore {
  workspaceId: string | null
  closedFolderIds: string[]
  /**
   * Id of a row to put into inline-rename mode as soon as the tree sees it.
   * Set by creation handlers (NewItemButton) so freshly-created folders /
   * requests / connections enter rename mode without the tree component
   * having to be reachable as a ref. Cleared once the tree consumes it.
   */
  pendingRenameId: string | null
  /**
   * The tree row the user most recently clicked or arrow-navigated to.
   * Shared with the TopBar so Cmd+N can target the focused folder
   * (or the focused request's parent folder) instead of the workspace root.
   * Cleared on workspace switch.
   */
  focusedNodeId: string | null
  /**
   * Multi-select set. The focused row is always included (the focus is the
   * "head" of the selection). Cmd/Ctrl+click toggles individual ids;
   * Shift+click or Shift+Arrow extends a range from the anchor.
   */
  selectedIds: string[]
  /**
   * Anchor for range-extending operations (Shift+Arrow, Shift+click). Set on
   * any plain click and on the first Shift-extension; range is always
   * `anchor → focused`.
   */
  selectionAnchorId: string | null
  initForWorkspace: (workspaceId: string) => void
  isFolderOpen: (id: string) => boolean
  toggleFolder: (id: string) => void
  ensureFoldersOpen: (ids: string[]) => void
  setFocusedNodeId: (id: string | null) => void
  setSelection: (ids: string[], anchorId?: string | null) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  /** Queue a row for inline-rename mode (consumed by the tree once mounted). */
  requestRename: (id: string) => void
  /** Tree calls this after starting rename to acknowledge the request. */
  consumePendingRename: () => void
  focusNewItem: (id: string) => void
}

export const useTreeUiStore = create<TreeUiStore>((set, get) => ({
  workspaceId: null,
  closedFolderIds: [],
  focusedNodeId: null,
  selectedIds: [],
  selectionAnchorId: null,
  pendingRenameId: null,

  initForWorkspace: (workspaceId) => {
    if (get().workspaceId === workspaceId) return
    set({
      workspaceId,
      closedFolderIds: loadClosed(workspaceId),
      focusedNodeId: null,
      selectedIds: [],
      selectionAnchorId: null,
      pendingRenameId: null,
    })
  },

  isFolderOpen: (id) => !get().closedFolderIds.includes(id),

  toggleFolder: (id) => {
    const { workspaceId, closedFolderIds } = get()
    const wasClosed = closedFolderIds.includes(id)
    const next = wasClosed
      ? closedFolderIds.filter((i) => i !== id)
      : [...closedFolderIds, id]
    set({ closedFolderIds: next })
    if (workspaceId) saveClosed(workspaceId, next)
  },

  ensureFoldersOpen: (ids) => {
    const { workspaceId, closedFolderIds } = get()
    const next = closedFolderIds.filter((id) => !ids.includes(id))
    if (next.length === closedFolderIds.length) return // nothing to change
    set({ closedFolderIds: next })
    if (workspaceId) saveClosed(workspaceId, next)
  },

  setFocusedNodeId: (id) => set({ focusedNodeId: id }),

  setSelection: (ids, anchorId) =>
    set((s) => ({
      selectedIds: ids,
      selectionAnchorId:
        anchorId !== undefined ? anchorId : s.selectionAnchorId,
    })),

  toggleSelected: (id) =>
    set((s) => {
      const next = s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id]
      // Cmd-click both moves focus and re-anchors so a subsequent
      // Shift-extend grows from this row.
      return { selectedIds: next, focusedNodeId: id, selectionAnchorId: id }
    }),

  clearSelection: () => set({ selectedIds: [], selectionAnchorId: null }),

  requestRename: (id) => set({ pendingRenameId: id }),
  consumePendingRename: () => set({ pendingRenameId: null }),

  focusNewItem: (id) =>
    set({
      focusedNodeId: id,
      selectedIds: [id],
      selectionAnchorId: id,
      pendingRenameId: id,
    }),
}))
