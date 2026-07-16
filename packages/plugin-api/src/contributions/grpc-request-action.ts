import type { GrpcRequest } from "@voleeo/types/bindings"
import type { Context } from "../context"

/** Action that operates on a single saved gRPC request.
 *
 * Surfaces in the request-tree right-click menu for gRPC nodes. Typical use:
 * "Copy as grpcurl".
 */
export interface GrpcRequestActionContribution {
  id: string
  label: string
  glyph?: string
  isEnabled?(request: GrpcRequest): boolean
  onInvoke(ctx: Context, request: GrpcRequest): Promise<void> | void
}
