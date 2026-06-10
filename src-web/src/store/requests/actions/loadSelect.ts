import { buildTree } from "../buildTree"
import {
  loadLastRequestId,
  loadRecentRequestIds,
  pushRecent,
  saveLastRequestId,
  saveRecentRequestIds,
} from "../persistence"
import { fetchEntities, type GetState, type SetState } from "./shared"

/** Load/reload and active-item selection — the navigation surface of the store. */
export function loadSelectActions(set: SetState, get: GetState) {
  return {
    load: async (workspaceId: string) => {
      if (get().loadedWorkspaceId === workspaceId) return
      const { folders, requests, connections } =
        await fetchEntities(workspaceId)
      const remembered = loadLastRequestId(workspaceId)
      const activeRequestId =
        remembered != null && requests.some((r) => r.id === remembered)
          ? remembered
          : null
      const requestIds = new Set(requests.map((r) => r.id))
      const recentRequestIds = loadRecentRequestIds(workspaceId).filter((id) =>
        requestIds.has(id),
      )
      set({
        folders,
        requests,
        connections,
        tree: buildTree(folders, requests, connections),
        loadedWorkspaceId: workspaceId,
        activeRequestId,
        recentRequestIds,
      })
    },

    reload: async () => {
      const workspaceId = get().loadedWorkspaceId
      if (!workspaceId) return
      const { folders, requests, connections } =
        await fetchEntities(workspaceId)
      set({
        folders,
        requests,
        connections,
        tree: buildTree(folders, requests, connections),
      })
    },

    setActiveRequest: (id: string | null) => {
      const { loadedWorkspaceId, recentRequestIds } = get()
      if (loadedWorkspaceId) saveLastRequestId(loadedWorkspaceId, id)
      const next = id ? pushRecent(recentRequestIds, id) : recentRequestIds
      if (loadedWorkspaceId && id) saveRecentRequestIds(loadedWorkspaceId, next)
      set({
        activeRequestId: id,
        activeFolderId: null,
        activeConnectionId: null,
        recentRequestIds: next,
      })
    },

    setActiveFolder: (id: string | null) => {
      if (id)
        set({
          activeFolderId: id,
          activeRequestId: null,
          activeConnectionId: null,
        })
      else set({ activeFolderId: null })
    },

    setActiveConnection: (id: string | null) => {
      if (id)
        set({
          activeConnectionId: id,
          activeRequestId: null,
          activeFolderId: null,
        })
      else set({ activeConnectionId: null })
    },

    focusFolderVariable: (folderId: string, key: string) =>
      set({
        activeFolderId: folderId,
        activeRequestId: null,
        activeConnectionId: null,
        pendingFolderFocus: { folderId, tab: "variables", key },
      }),

    focusFolderHeader: (folderId: string, key: string) =>
      set({
        activeFolderId: folderId,
        activeRequestId: null,
        activeConnectionId: null,
        pendingFolderFocus: { folderId, tab: "headers", key },
      }),

    consumePendingFolderFocus: () => set({ pendingFolderFocus: null }),
  }
}
