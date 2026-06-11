import type {
  AuthConfig,
  EnvironmentVariable,
  GrpcRequestUpdate,
  MoveItemUpdate,
  RequestBody,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import type { GetState, SetState } from "./shared"

/** Field edits (request/connection/folder) and drag-reorder persistence. */
export function mutationActions(set: SetState, get: GetState) {
  return {
    updateRequest: async (
      workspaceId: string,
      id: string,
      method: string,
      url: string,
      parameters?: RequestParameter[],
      headers?: RequestParameter[],
      body?: RequestBody | null,
      auth?: AuthConfig,
    ) => {
      const params = parameters ?? []
      const hdrs = headers ?? []
      const existing = get().requests.find((r) => r.id === id)
      const persistedBody = body !== undefined ? body : (existing?.body ?? null)
      const persistedAuth: AuthConfig = auth ??
        existing?.auth ?? { kind: "none" }
      set((s) => {
        const requests = s.requests.map((r) =>
          r.id === id
            ? {
                ...r,
                method,
                url,
                parameters: params,
                headers: hdrs,
                body: body !== undefined ? body : r.body,
                auth: persistedAuth,
                updatedAt: new Date().toISOString(),
              }
            : r,
        )
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections, s.grpcRequests),
        }
      })
      await commands.updateRequest(
        workspaceId,
        id,
        method,
        url,
        params,
        hdrs,
        persistedBody,
        persistedAuth,
      )
    },

    updateConnection: async (
      workspaceId: string,
      id: string,
      patch: {
        url: string
        parameters: RequestParameter[]
        headers: RequestParameter[]
        auth: AuthConfig
      },
    ) => {
      set((s) => {
        const connections = s.connections.map((c) =>
          c.id === id
            ? { ...c, ...patch, updatedAt: new Date().toISOString() }
            : c,
        )
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections, s.grpcRequests),
        }
      })
      await commands.updateWsConnection(
        workspaceId,
        id,
        patch.url,
        patch.parameters,
        patch.headers,
        patch.auth,
      )
    },

    updateGrpc: async (
      workspaceId: string,
      id: string,
      patch: GrpcRequestUpdate,
    ) => {
      set((s) => {
        const grpcRequests = s.grpcRequests.map((g) =>
          g.id === id
            ? { ...g, ...patch, updatedAt: new Date().toISOString() }
            : g,
        )
        return {
          grpcRequests,
          tree: buildTree(s.folders, s.requests, s.connections, grpcRequests),
        }
      })
      await commands.updateGrpcRequest(workspaceId, id, patch)
    },

    updateFolder: async (
      workspaceId: string,
      id: string,
      headers: RequestParameter[],
      auth: AuthConfig,
    ) => {
      set((s) => {
        const folders = s.folders.map((f) =>
          f.id === id
            ? { ...f, headers, auth, updatedAt: new Date().toISOString() }
            : f,
        )
        return {
          folders,
          tree: buildTree(folders, s.requests, s.connections, s.grpcRequests),
        }
      })
      await commands.updateFolder(workspaceId, id, headers, auth)
    },

    updateFolderColor: async (
      workspaceId: string,
      id: string,
      color: string | null,
    ) => {
      set((s) => {
        const folders = s.folders.map((f) =>
          f.id === id
            ? { ...f, color, updatedAt: new Date().toISOString() }
            : f,
        )
        return {
          folders,
          tree: buildTree(folders, s.requests, s.connections, s.grpcRequests),
        }
      })
      await commands.updateFolderColor(workspaceId, id, color)
    },

    updateFolderVariables: async (
      workspaceId: string,
      id: string,
      variables: EnvironmentVariable[],
    ) => {
      set((s) => {
        const folders = s.folders.map((f) =>
          f.id === id
            ? { ...f, variables, updatedAt: new Date().toISOString() }
            : f,
        )
        return {
          folders,
          tree: buildTree(folders, s.requests, s.connections, s.grpcRequests),
        }
      })
      await commands.updateFolderVariables(workspaceId, id, variables)
    },

    moveItems: async (workspaceId: string, updates: MoveItemUpdate[]) => {
      set((s) => {
        const folders = s.folders.map((f) => {
          const u = updates.find((u) => u.id === f.id && u.kind === "folder")
          return u ? { ...f, folderId: u.folderId, order: u.order } : f
        })
        const requests = s.requests.map((r) => {
          const u = updates.find((u) => u.id === r.id && u.kind === "request")
          return u ? { ...r, folderId: u.folderId, order: u.order } : r
        })
        const connections = s.connections.map((c) => {
          const u = updates.find((u) => u.id === c.id && u.kind === "webSocket")
          return u ? { ...c, folderId: u.folderId, order: u.order } : c
        })
        const grpcRequests = s.grpcRequests.map((g) => {
          const u = updates.find((u) => u.id === g.id && u.kind === "grpc")
          return u ? { ...g, folderId: u.folderId, order: u.order } : g
        })
        return {
          folders,
          requests,
          connections,
          grpcRequests,
          tree: buildTree(folders, requests, connections, grpcRequests),
        }
      })
      await commands.moveItems(workspaceId, updates)
    },
  }
}
