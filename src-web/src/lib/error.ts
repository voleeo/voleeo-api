import type { VoleeoError } from "../../../packages/types/bindings"

/**
 * Human-readable message for a command error.
 * Tolerates non-`VoleeoError` rejections too (e.g. Tauri's "Command X not found" string, plain Errors)
 * so a failure never renders as an empty/blank banner.
 */
export function errorMessage(e: VoleeoError | string | unknown): string {
  if (typeof e === "string") return e
  if (e && typeof e === "object" && "kind" in e) {
    const err = e as VoleeoError
    if (err.kind === "http_failed") return err.data.message
    if (err.kind === "grpc_failed") return err.data.message
    if (err.kind === "cancelled") return "Cancelled"
    if (err.kind === "web_socket_closed") return "WebSocket closed"
    return err.data
  }
  if (e instanceof Error) return e.message
  return String(e ?? "Unknown error")
}
