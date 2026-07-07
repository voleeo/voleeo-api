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
  pendingRenameId: string | null
  focusedNodeId: string | null
  selectedIds: string[]
  selectionAnchorId: string | null
  initForWorkspace: (workspaceId: string) => void
  isFolderOpen: (id: string) => boolean
  toggleFolder: (id: string) => void
  ensureFoldersOpen: (ids: string[]) => void
  collapseAll: (folderIds: string[]) => void
  expandAll: () => void
  setFocusedNodeId: (id: string | null) => void
  setSelection: (ids: string[], anchorId?: string | null) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  requestRename: (id: string) => void
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

  collapseAll: (folderIds) => {
    set({ closedFolderIds: folderIds })
    const { workspaceId } = get()
    if (workspaceId) saveClosed(workspaceId, folderIds)
  },

  expandAll: () => {
    set({ closedFolderIds: [] })
    const { workspaceId } = get()
    if (workspaceId) saveClosed(workspaceId, [])
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
