import type { VoleeoError } from "../../../packages/types/bindings"

export function errorMessage(e: VoleeoError): string {
  if (e.kind === "http_failed") return e.data.message
  if (e.kind === "grpc_failed") return e.data.message
  if (e.kind === "cancelled") return "Cancelled"
  if (e.kind === "web_socket_closed") return "WebSocket closed"
  return e.data
}
