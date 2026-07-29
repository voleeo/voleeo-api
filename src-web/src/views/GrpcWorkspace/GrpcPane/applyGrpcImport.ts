import type { ParsedGrpcRequest } from "@/lib/grpcurlParser"
import { useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import type { AuthConfig } from "../../../../../packages/types/bindings"
import type { GrpcDraft } from "./useGrpcDraft"

/** Replace a gRPC request's whole connection from a pasted grpcurl command.
 *
 * Draft state is set alongside the store write because `tls`, `protoSource`,
 * `service` and `method` are seeded once from `request` and don't re-sync on
 * external change (unlike target/message/metadata, which have reset effects). */
export function applyGrpcImport(
  p: ParsedGrpcRequest,
  ctx: {
    workspaceId: string
    requestId: string
    draft: GrpcDraft
    auth: AuthConfig
  },
): void {
  const { workspaceId, requestId, draft, auth } = ctx

  draft.setTarget(p.target)
  draft.setTls(p.tls)
  draft.setProtoSource(p.protoSource)
  // Don't reseed an empty form over the body we just parsed out of `-d`.
  if (p.service && p.method)
    draft.selectMethod(p.service, p.method, !p.message.trim())
  else draft.clearMethod()
  draft.setMetadata(p.metadata)

  void useRequestStore.getState().updateGrpc(workspaceId, requestId, {
    target: p.target,
    tls: p.tls,
    protoSource: p.protoSource,
    service: p.service,
    method: p.method,
    metadata: p.metadata,
    message: p.message,
    auth,
  })
  useToastStore.getState().show("Pasted grpcurl command", undefined, "success")
}
