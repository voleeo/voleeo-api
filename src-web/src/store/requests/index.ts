import { create } from "zustand"
import { saveItemsCount } from "@/lib/workspaceCounts"
import type {
  ApiFolder,
  AuthConfig,
  BodyField,
  BodyKind,
  EnvironmentVariable,
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

export const useRequestStore = create<RequestStore>((set, get) => ({
  folders: [],
  requests: [],
  connections: [],
  tree: [],
  activeRequestId: null,
  activeFolderId: null,
  activeConnectionId: null,
  loadedWorkspaceId: null,
  recentRequestIds: [],
  pendingFolderFocus: null,
  ...createActions(set, get),
}))

useRequestStore.subscribe((state, prev) => {
  if (state.requests !== prev.requests && state.loadedWorkspaceId) {
    saveItemsCount(state.loadedWorkspaceId, state.requests.length)
  }
})
