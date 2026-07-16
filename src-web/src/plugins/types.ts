import type { PreviewResult, TemplateFunctionArg } from "@voleeo/plugin-api"
import type { GrpcRequest, HttpRequest } from "../../../packages/types/bindings"

/** Host-facing shape of a template function returned by the registry.
 *
 * Each function's owning-plugin `Context` is bound by the registry at
 * `templateFunctions()` time, so `onRender` only needs the args. This is
 * what `resolveTemplate` and the modal preview pane consume — there's no
 * way for a host to accidentally pass the wrong ctx, because there's no
 * ctx parameter to pass. Plugin authors continue to declare
 * `TemplateFunctionContribution` (which still takes `ctx`); the registry
 * adapts it to this shape. */
export interface BoundTemplateFunction {
  name: string
  label?: string
  description?: string
  args?: TemplateFunctionArg[]
  previewable?: boolean
  onRender(args: Record<string, string>): Promise<string | null> | string | null
  previewRender?(
    args: Record<string, string>,
  ): Promise<PreviewResult | null> | PreviewResult | null
}

/** Host-facing shape of a request action returned by the registry.
 *
 * Owning-plugin `Context` is bound at registry time so `onInvoke` only
 * takes the request — same closure pattern as `BoundTemplateFunction`. */
export interface BoundRequestAction {
  id: string
  label: string
  glyph?: string
  isEnabled?(request: HttpRequest): boolean
  onInvoke(request: HttpRequest): Promise<void> | void
}

/** Host-facing gRPC request action — ctx bound at registry time. */
export interface BoundGrpcRequestAction {
  id: string
  label: string
  glyph?: string
  isEnabled?(request: GrpcRequest): boolean
  onInvoke(request: GrpcRequest): Promise<void> | void
}
