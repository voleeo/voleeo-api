export type CtxMenuState =
  | { kind: "workspace"; x: number; y: number }
  | { kind: "request"; id: string; x: number; y: number }
  | { kind: "folder"; id: string; x: number; y: number }
  | { kind: "websocket"; id: string; x: number; y: number }
  | { kind: "grpc"; id: string; x: number; y: number }

export type ItemKindUi = "request" | "folder" | "websocket" | "grpc"
export type RollbackTarget = "request" | "folder" | "folder-requests"
