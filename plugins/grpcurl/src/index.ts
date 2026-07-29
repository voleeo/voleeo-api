import type {
  GrpcRequestActionContribution,
  VoleeoPlugin,
} from "@voleeo/plugin-api"
import type { GrpcRequest } from "@voleeo/types/bindings"
import { serializeAsGrpcurl } from "./serialize"

function canCopy(request: GrpcRequest): boolean {
  return (
    Boolean(request.target?.trim()) &&
    Boolean(request.service?.trim()) &&
    Boolean(request.method?.trim())
  )
}

const copyAsGrpcurl: GrpcRequestActionContribution = {
  id: "copy-as-grpcurl",
  label: "Copy as grpcurl",
  glyph: "terminal",
  isEnabled: canCopy,
  async onInvoke(ctx, request) {
    try {
      const cmd = await serializeAsGrpcurl(request, ctx)
      await ctx.clipboard.copyText(cmd)
      ctx.toast.show({ message: "Copied grpcurl command", kind: "success" })
    } catch (e) {
      ctx.log.error("Failed to serialize grpcurl:", e)
      ctx.toast.show({
        message: "Failed to copy as grpcurl — see console",
        kind: "error",
      })
    }
  },
}

export const plugin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/grpcurl",
    name: "Copy as grpcurl",
    version: "0.1.0",
    author: "Voleeo",
  },
  grpcRequestActions: [copyAsGrpcurl],
}
