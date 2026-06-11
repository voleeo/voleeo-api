import type { StoreApi } from "zustand"
import { commands } from "../../../../../packages/types/bindings"
import type { RequestStore } from "../types"

export const DEFAULT_REQUEST_NAME = "New Request"
export const DEFAULT_CONNECTION_NAME = "New WebSocket"

export type SetState = StoreApi<RequestStore>["setState"]
export type GetState = StoreApi<RequestStore>["getState"]

export const DEFAULT_GRPC_NAME = "New gRPC"

/** Fetch folders/requests/connections/gRPC for a workspace, defaulting failures to []. */
export async function fetchEntities(workspaceId: string) {
  const [foldersRes, requestsRes, connectionsRes, grpcRes] = await Promise.all([
    commands.listFolders(workspaceId),
    commands.listRequests(workspaceId),
    commands.listWsConnections(workspaceId),
    commands.listGrpcRequests(workspaceId),
  ])
  return {
    folders: foldersRes.status === "ok" ? foldersRes.data : [],
    requests: requestsRes.status === "ok" ? requestsRes.data : [],
    connections: connectionsRes.status === "ok" ? connectionsRes.data : [],
    grpcRequests: grpcRes.status === "ok" ? grpcRes.data : [],
  }
}
