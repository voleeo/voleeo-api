import { type ResolutionLog, resolveTemplate } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { EnvironmentVariable } from "@/store/environment"
import type { RequestParameter } from "../../../../../../packages/types/bindings"

/** Shared resolution context — `log.events` accumulates across every step. */
export interface ResolveCtx {
  vars: EnvironmentVariable[]
  fns: BoundTemplateFunction[]
  log: ResolutionLog
}

// Spread shares `log.events`, so events land in the one accumulating array.
export const resolve = (ctx: ResolveCtx, value: string, label: string) =>
  resolveTemplate(value, ctx.vars, ctx.fns, { ...ctx.log, label })

export function authHeader(name: string, value: string): RequestParameter {
  return { id: "__auth", name, value, enabled: true }
}
