import type { GrpcRpcKind } from "../../../../../packages/types/bindings"

export const RPC_KIND: Record<
  GrpcRpcKind,
  { label: string; icon: string; color: string }
> = {
  unary: { label: "Unary", icon: "arrow", color: "var(--base0D)" },
  server_streaming: {
    label: "Server streaming",
    icon: "arrow",
    color: "var(--base0B)",
  },
  client_streaming: {
    label: "Client streaming",
    icon: "arrow-left",
    color: "var(--base0A)",
  },
  bidi: {
    label: "Bidirectional",
    icon: "arrows-left-right",
    color: "var(--base0E)",
  },
}

export const RPC_KINDS: GrpcRpcKind[] = [
  "unary",
  "server_streaming",
  "client_streaming",
  "bidi",
]
