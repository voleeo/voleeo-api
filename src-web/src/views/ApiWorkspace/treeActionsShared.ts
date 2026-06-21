import { useRequestStore } from "@/store/requests"

export type NodeKind = "request" | "folder" | "websocket" | "grpc"

export interface PendingDelete {
  kind: NodeKind
  id: string
  name: string
}

/** Repo-relative file for a tree node — matches the storage layer's naming. */
export function entityPath(kind: NodeKind, id: string): string {
  if (kind === "request") return `req_${id}.yaml`
  if (kind === "websocket") return `ws_${id}.yaml`
  if (kind === "grpc") return `grpc_${id}.yaml`
  return `folder_${id}.yaml`
}

export function entityName(kind: NodeKind, id: string): string {
  const { requests, folders, connections, grpcRequests } =
    useRequestStore.getState()
  if (kind === "request")
    return requests.find((r) => r.id === id)?.name ?? "this request"
  if (kind === "websocket")
    return connections.find((c) => c.id === id)?.name ?? "this connection"
  if (kind === "grpc")
    return grpcRequests.find((g) => g.id === id)?.name ?? "this gRPC request"
  return folders.find((f) => f.id === id)?.name ?? "this folder"
}
