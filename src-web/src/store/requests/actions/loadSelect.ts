import { buildTree } from "../buildTree"
import {
  loadLastRequestId,
  loadRecentRequestIds,
  pushRecent,
  saveLastRequestId,
  saveRecentRequestIds,
} from "../persistence"
import { fetchEntities, type GetState, type SetState } from "./shared"

function pushRecentNode(get: GetState, id: string | null): string[] {
  const { loadedWorkspaceId, recentNodeIds } = get()
  if (!id) return recentNodeIds
  const next = pushRecent(recentNodeIds, id)
  if (loadedWorkspaceId) saveRecentRequestIds(loadedWorkspaceId, next)
  return next
}

/** Load/reload and active-item selection — the navigation surface of the store. */
export function loadSelectActions(set: SetState, get: GetState) {
  return {
    load: async (workspaceId: string) => {
      if (get().loadedWorkspaceId === workspaceId) return
      const { folders, requests, connections, grpcRequests } =
        await fetchEntities(workspaceId)
      const remembered = loadLastRequestId(workspaceId)
      const activeRequestId =
        remembered != null && requests.some((r) => r.id === remembered)
          ? remembered
          : null
      // Recents span every entity type (HTTP / WS / gRPC), not just requests.
      const nodeIds = new Set<string>([
        ...requests.map((r) => r.id),
        ...connections.map((c) => c.id),
        ...grpcRequests.map((g) => g.id),
      ])
      const recentNodeIds = loadRecentRequestIds(workspaceId).filter((id) =>
        nodeIds.has(id),
      )
      set({
        folders,
        requests,
        connections,
        grpcRequests,
        tree: buildTree(folders, requests, connections, grpcRequests),
        loadedWorkspaceId: workspaceId,
        activeRequestId,
        recentNodeIds,
      })
    },

    reload: async () => {
      const workspaceId = get().loadedWorkspaceId
      if (!workspaceId) return
      const { folders, requests, connections, grpcRequests } =
        await fetchEntities(workspaceId)
      set({
        folders,
        requests,
        connections,
        grpcRequests,
        tree: buildTree(folders, requests, connections, grpcRequests),
      })
    },

    setActiveRequest: (id: string | null) => {
      const { loadedWorkspaceId } = get()
      if (loadedWorkspaceId) saveLastRequestId(loadedWorkspaceId, id)
      set({
        activeRequestId: id,
        activeFolderId: null,
        activeConnectionId: null,
        activeGrpcId: null,
        recentNodeIds: pushRecentNode(get, id),
      })
    },

    setActiveFolder: (id: string | null) => {
      if (id)
        set({
          activeFolderId: id,
          activeRequestId: null,
          activeConnectionId: null,
          activeGrpcId: null,
        })
      else set({ activeFolderId: null })
    },

    setActiveConnection: (id: string | null) => {
      if (id)
        set({
          activeConnectionId: id,
          activeRequestId: null,
          activeFolderId: null,
          activeGrpcId: null,
          recentNodeIds: pushRecentNode(get, id),
        })
      else set({ activeConnectionId: null })
    },

    setActiveGrpc: (id: string | null) => {
      if (id)
        set({
          activeGrpcId: id,
          activeRequestId: null,
          activeFolderId: null,
          activeConnectionId: null,
          recentNodeIds: pushRecentNode(get, id),
        })
      else set({ activeGrpcId: null })
    },

    focusFolderVariable: (folderId: string, key: string) =>
      set({
        activeFolderId: folderId,
        activeRequestId: null,
        activeConnectionId: null,
        activeGrpcId: null,
        pendingFolderFocus: { folderId, tab: "variables", key },
      }),

    focusFolderHeader: (folderId: string, key: string) =>
      set({
        activeFolderId: folderId,
        activeRequestId: null,
        activeConnectionId: null,
        activeGrpcId: null,
        pendingFolderFocus: { folderId, tab: "headers", key },
      }),

    consumePendingFolderFocus: () => set({ pendingFolderFocus: null }),
  }
}
