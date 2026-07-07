import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import {
  DEFAULT_GRPC_NAME,
  type GetState,
  type SetState,
  syncOnFailure,
} from "./shared"

/** Create / duplicate / rename / delete for gRPC requests. */
export function grpcCrudActions(set: SetState, get: GetState) {
  return {
    createGrpc: async (
      workspaceId: string,
      opts: { folderId?: string; name?: string; target?: string } = {},
    ) => {
      const res = await commands.createGrpcRequest(
        workspaceId,
        opts.folderId ?? null,
        opts.name ?? DEFAULT_GRPC_NAME,
        opts.target ?? "",
      )
      if (res.status !== "ok") return null
      const request = res.data
      set((s) => {
        const grpcRequests = [...s.grpcRequests, request]
        return {
          grpcRequests,
          tree: buildTree(s.folders, s.requests, s.connections, grpcRequests),
          activeGrpcId: request.id,
          activeRequestId: null,
          activeFolderId: null,
          activeConnectionId: null,
        }
      })
      return request
    },

    duplicateGrpc: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateGrpcRequest(workspaceId, id)
      if (res.status !== "ok") return null
      set((s) => {
        const grpcRequests = [...s.grpcRequests, res.data]
        return {
          grpcRequests,
          tree: buildTree(s.folders, s.requests, s.connections, grpcRequests),
        }
      })
      return res.data
    },

    renameGrpc: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const grpcRequests = s.grpcRequests.map((g) =>
          g.id === id ? { ...g, name } : g,
        )
        return {
          grpcRequests,
          tree: buildTree(s.folders, s.requests, s.connections, grpcRequests),
        }
      })
      const res = await commands.renameGrpcRequest(workspaceId, id, name)
      await syncOnFailure(get, res, "rename gRPC request")
    },

    deleteGrpc: async (workspaceId: string, id: string) => {
      set((s) => {
        const grpcRequests = s.grpcRequests.filter((g) => g.id !== id)
        return {
          grpcRequests,
          tree: buildTree(s.folders, s.requests, s.connections, grpcRequests),
          activeGrpcId: s.activeGrpcId === id ? null : s.activeGrpcId,
        }
      })
      const res = await commands.deleteGrpcRequest(workspaceId, id)
      await syncOnFailure(get, res, "delete gRPC request")
    },
  }
}
