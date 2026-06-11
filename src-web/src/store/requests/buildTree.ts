import type {
  ApiFolder,
  GrpcRequest,
  HttpRequest,
  WsConnection,
} from "../../../../packages/types/bindings"

export type TreeNode =
  | { kind: "folder"; folder: ApiFolder; children: TreeNode[] }
  | { kind: "request"; request: HttpRequest }
  | { kind: "websocket"; connection: WsConnection }
  | { kind: "grpc"; request: GrpcRequest }

export function effectiveOrder(n: TreeNode): number {
  const order =
    n.kind === "folder"
      ? (n.folder.order ?? 0)
      : n.kind === "websocket"
        ? (n.connection.order ?? 0)
        : (n.request.order ?? 0)
  const createdAt =
    n.kind === "folder"
      ? n.folder.createdAt
      : n.kind === "websocket"
        ? n.connection.createdAt
        : n.request.createdAt
  return order || Date.parse(createdAt)
}

export function buildTree(
  folders: ApiFolder[],
  requests: HttpRequest[],
  connections: WsConnection[] = [],
  grpcRequests: GrpcRequest[] = [],
  parentId: string | null = null,
): TreeNode[] {
  const folderNodes: TreeNode[] = folders
    .filter((f) => (f.folderId ?? null) === parentId)
    .map((folder) => ({
      kind: "folder" as const,
      folder,
      children: buildTree(
        folders,
        requests,
        connections,
        grpcRequests,
        folder.id,
      ),
    }))

  const requestNodes: TreeNode[] = requests
    .filter((r) => (r.folderId ?? null) === parentId)
    .map((request) => ({ kind: "request" as const, request }))

  const connectionNodes: TreeNode[] = connections
    .filter((c) => (c.folderId ?? null) === parentId)
    .map((connection) => ({ kind: "websocket" as const, connection }))

  const grpcNodes: TreeNode[] = grpcRequests
    .filter((g) => (g.folderId ?? null) === parentId)
    .map((request) => ({ kind: "grpc" as const, request }))

  // Sort all kinds together by effective order (numeric, not string).
  return [
    ...folderNodes,
    ...requestNodes,
    ...connectionNodes,
    ...grpcNodes,
  ].sort((a, b) => effectiveOrder(a) - effectiveOrder(b))
}
