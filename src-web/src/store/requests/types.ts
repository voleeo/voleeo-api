import type {
  ApiFolder,
  AuthConfig,
  EnvironmentVariable,
  GrpcRequest,
  GrpcRequestUpdate,
  HttpRequest,
  MoveItemUpdate,
  RequestBody,
  RequestParameter,
  WsConnection,
} from "../../../../packages/types/bindings"
import type { TreeNode } from "./buildTree"

export type Duplicated = { id: string; folderId: string | null } | null

export interface RequestStore {
  folders: ApiFolder[]
  requests: HttpRequest[]
  connections: WsConnection[]
  grpcRequests: GrpcRequest[]
  tree: TreeNode[]
  /** Mutually exclusive with the other `active*Id` fields. */
  activeRequestId: string | null
  /** Mutually exclusive with the other `active*Id` fields. */
  activeFolderId: string | null
  /** Mutually exclusive with the other `active*Id` fields. */
  activeConnectionId: string | null
  /** Mutually exclusive with the other `active*Id` fields. */
  activeGrpcId: string | null
  /** Open saved pair (read-only view). Lowest render precedence: any other
   *  `active*Id` wins the center pane, so direct crud writes to those fields
   *  don't need to clear this one. */
  activeSnapshotId: string | null
  loadedWorkspaceId: string | null
  /** Recently-activated nodes of any type (HTTP / WS / gRPC), most-recent-first. */
  recentNodeIds: string[]
  pendingFolderFocus: {
    folderId: string
    tab: "headers" | "variables"
    key: string
  } | null

  load: (workspaceId: string) => Promise<void>
  reload: () => Promise<void>
  setActiveRequest: (id: string | null) => void
  setActiveFolder: (id: string | null) => void
  setActiveConnection: (id: string | null) => void
  setActiveGrpc: (id: string | null) => void
  setActiveSnapshot: (id: string | null) => void
  focusFolderVariable: (folderId: string, key: string) => void
  focusFolderHeader: (folderId: string, key: string) => void
  consumePendingFolderFocus: () => void
  createRequest: (
    workspaceId: string,
    opts?: {
      folderId?: string
      name?: string
      method?: string
      url?: string
      body?: RequestBody | null
      headers?: RequestParameter[]
    },
  ) => Promise<HttpRequest | null>
  createGraphqlRequest: (
    workspaceId: string,
    opts?: { folderId?: string; name?: string },
  ) => Promise<HttpRequest | null>
  createFolder: (
    workspaceId: string,
    opts?: { folderId?: string; name?: string },
  ) => Promise<ApiFolder | null>
  createConnection: (
    workspaceId: string,
    opts?: { folderId?: string; name?: string; url?: string },
  ) => Promise<WsConnection | null>
  createGrpc: (
    workspaceId: string,
    opts?: { folderId?: string; name?: string; target?: string },
  ) => Promise<GrpcRequest | null>
  moveItems: (workspaceId: string, updates: MoveItemUpdate[]) => Promise<void>
  duplicateRequest: (workspaceId: string, id: string) => Promise<Duplicated>
  duplicateFolder: (workspaceId: string, id: string) => Promise<Duplicated>
  duplicateConnection: (workspaceId: string, id: string) => Promise<Duplicated>
  duplicateGrpc: (workspaceId: string, id: string) => Promise<Duplicated>
  renameRequest: (
    workspaceId: string,
    id: string,
    name: string,
  ) => Promise<void>
  renameFolder: (workspaceId: string, id: string, name: string) => Promise<void>
  renameConnection: (
    workspaceId: string,
    id: string,
    name: string,
  ) => Promise<void>
  renameGrpc: (workspaceId: string, id: string, name: string) => Promise<void>
  deleteRequest: (workspaceId: string, id: string) => Promise<void>
  deleteFolder: (workspaceId: string, id: string) => Promise<void>
  deleteConnection: (workspaceId: string, id: string) => Promise<void>
  deleteGrpc: (workspaceId: string, id: string) => Promise<void>
  updateRequest: (
    workspaceId: string,
    id: string,
    method: string,
    url: string,
    parameters?: RequestParameter[],
    headers?: RequestParameter[],
    body?: RequestBody | null,
    auth?: AuthConfig,
  ) => Promise<void>
  /** Persist a connection's editable fields + reflect optimistically in the tree. */
  updateConnection: (
    workspaceId: string,
    id: string,
    patch: {
      url: string
      parameters: RequestParameter[]
      headers: RequestParameter[]
      auth: AuthConfig
    },
  ) => Promise<void>
  /** Persist a gRPC request's editable fields + reflect optimistically in the
   *  tree (mirrors `updateConnection`). */
  updateGrpc: (
    workspaceId: string,
    id: string,
    patch: GrpcRequestUpdate,
  ) => Promise<void>
  updateFolder: (
    workspaceId: string,
    id: string,
    headers: RequestParameter[],
    auth: AuthConfig,
  ) => Promise<void>
  updateFolderColor: (
    workspaceId: string,
    id: string,
    color: string | null,
  ) => Promise<void>
  updateFolderVariables: (
    workspaceId: string,
    id: string,
    variables: EnvironmentVariable[],
  ) => Promise<void>
}
