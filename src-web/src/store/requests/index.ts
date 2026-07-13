import { create } from "zustand"
import { saveItemsCount } from "@/lib/workspaceCounts"
import type {
  ApiFolder,
  AuthConfig,
  BodyField,
  BodyKind,
  EnvironmentVariable,
  GrpcRequest,
  HttpRequest,
  MoveItemUpdate,
  RequestBody,
  RequestParameter,
  WsConnection,
} from "../../../../packages/types/bindings"
import { createActions } from "./actions"
import type { RequestStore } from "./types"

export { DEFAULT_CONNECTION_NAME, DEFAULT_REQUEST_NAME } from "./actions"
export type { TreeNode } from "./buildTree"
export { buildTree, effectiveOrder } from "./buildTree"
export type {
  ApiFolder,
  AuthConfig,
  BodyField,
  BodyKind,
  EnvironmentVariable,
  GrpcRequest,
  HttpRequest,
  MoveItemUpdate,
  RequestBody,
  RequestParameter,
  WsConnection,
}

export function selectActiveRequest(state: RequestStore): HttpRequest | null {
  const { activeRequestId, requests } = state
  if (!activeRequestId) return null
  return requests.find((r) => r.id === activeRequestId) ?? null
}

export function selectActiveFolder(state: RequestStore): ApiFolder | null {
  const { activeFolderId, folders } = state
  if (!activeFolderId) return null
  return folders.find((f) => f.id === activeFolderId) ?? null
}

export function selectActiveConnection(
  state: RequestStore,
): WsConnection | null {
  const { activeConnectionId, connections } = state
  if (!activeConnectionId) return null
  return connections.find((c) => c.id === activeConnectionId) ?? null
}

export function selectActiveGrpc(state: RequestStore): GrpcRequest | null {
  const { activeGrpcId, grpcRequests } = state
  if (!activeGrpcId) return null
  return grpcRequests.find((g) => g.id === activeGrpcId) ?? null
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  folders: [],
  requests: [],
  connections: [],
  grpcRequests: [],
  tree: [],
  activeRequestId: null,
  activeSnapshotId: null,
  activeFolderId: null,
  activeConnectionId: null,
  activeGrpcId: null,
  loadedWorkspaceId: null,
  recentNodeIds: [],
  pendingFolderFocus: null,
  ...createActions(set, get),
}))

useRequestStore.subscribe((state, prev) => {
  if (state.requests !== prev.requests && state.loadedWorkspaceId) {
    saveItemsCount(state.loadedWorkspaceId, state.requests.length)
  }
})
