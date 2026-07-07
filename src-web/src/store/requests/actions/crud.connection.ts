import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import {
  DEFAULT_CONNECTION_NAME,
  type GetState,
  type SetState,
  syncOnFailure,
} from "./shared"

/** Create / duplicate / rename / delete for WebSocket connections. */
export function connectionCrudActions(set: SetState, get: GetState) {
  return {
    createConnection: async (
      workspaceId: string,
      opts: { folderId?: string; name?: string; url?: string } = {},
    ) => {
      const res = await commands.createWsConnection(
        workspaceId,
        opts.folderId ?? null,
        opts.name ?? DEFAULT_CONNECTION_NAME,
        opts.url ?? "",
      )
      if (res.status !== "ok") return null
      const connection = res.data
      set((s) => {
        const connections = [...s.connections, connection]
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections, s.grpcRequests),
          activeConnectionId: connection.id,
          activeRequestId: null,
          activeFolderId: null,
        }
      })
      return connection
    },

    duplicateConnection: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateWsConnection(workspaceId, id)
      if (res.status !== "ok") return null
      set((s) => {
        const connections = [...s.connections, res.data]
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections, s.grpcRequests),
        }
      })
      return res.data
    },

    renameConnection: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const connections = s.connections.map((c) =>
          c.id === id ? { ...c, name } : c,
        )
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections, s.grpcRequests),
        }
      })
      const res = await commands.renameWsConnection(workspaceId, id, name)
      await syncOnFailure(get, res, "rename connection")
    },

    deleteConnection: async (workspaceId: string, id: string) => {
      set((s) => {
        const connections = s.connections.filter((c) => c.id !== id)
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections, s.grpcRequests),
          activeConnectionId:
            s.activeConnectionId === id ? null : s.activeConnectionId,
        }
      })
      const res = await commands.deleteWsConnection(workspaceId, id)
      await syncOnFailure(get, res, "delete connection")
    },
  }
}
