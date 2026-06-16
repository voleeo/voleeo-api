import { emit } from "@tauri-apps/api/event"
import type { ResolutionEvent } from "@/lib/template"
import { resolveTemplate } from "@/lib/template"
import { useEnvironmentStore } from "@/store/environment"
import { sendRequestCommand } from "@/store/http"
import type { AuthConfig } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { extractPathParams } from "@/views/ApiWorkspace/paramUtils"
import {
  applyAuthForSend,
  resolveBody,
  resolveInheritedAuthAnnotated,
} from "@/views/ApiWorkspace/sendResolution"
import { markResolving, type RequestSender, unmarkResolving } from "./strategy"

// Pre-flight events accumulated during a resolution cycle.
// RequestPane drains this after resolveSendPayload so they appear in the timing tab.
export const pendingPreflightEvents: ResolutionEvent[] = []

export function buildSender(callerName: string): RequestSender {
  return async (workspaceId, requestId) => {
    if (!markResolving(requestId))
      throw new Error(
        `Cycle detected: "${callerName}" indirectly references itself via response.*`,
      )
    try {
      const req = useRequestStore
        .getState()
        .requests.find((r) => r.id === requestId)
      if (!req) throw new Error(`Pre-flight request failed: request not found`)

      const { environments, activeEnvId } = useEnvironmentStore.getState()
      const globalVars =
        environments
          .find((e) => e.kind === "global")
          ?.variables.filter((v) => v.enabled) ?? []
      const activeVars =
        environments
          .find((e) => e.id === activeEnvId)
          ?.variables.filter((v) => v.enabled) ?? []
      // Active env takes precedence over global (same logic as RequestPane/mergeEnvVars).
      const activeKeys = new Set(activeVars.map((v) => v.key))
      const vars = [
        ...activeVars,
        ...globalVars.filter((v) => !activeKeys.has(v.key)),
      ]

      // Template functions are resolved lazily via the registry to avoid a circular dep.
      const { registry } = await import("@/plugins/registry")
      const fns = registry.templateFunctions()

      // Substitute :param placeholders using stored parameter values before template resolution.
      const pathParamNames = extractPathParams(req.url)
      let urlWithPathParams = req.url
      for (const paramName of pathParamNames) {
        const param = (req.parameters ?? []).find(
          (p) => p.name === paramName && p.enabled !== false,
        )
        const value = param ? await resolveTemplate(param.value, vars, fns) : ""
        urlWithPathParams = urlWithPathParams.replace(
          new RegExp(`:${paramName}(?=[/?#]|$)`),
          encodeURIComponent(value),
        )
      }
      // Resolve URL, headers, and body here. Template *functions* (e.g.
      // faker.animal.type()) only exist in the JS registry — the Rust backend
      // can resolve {{ ENV }} vars but not function calls, so the body must be
      // fully resolved here or it reaches the server as a literal token.
      const ctx = { vars, fns, log: { events: [], label: "" } }
      const resolvedUrl = await resolveTemplate(urlWithPathParams, vars, fns)
      const resolvedHeaders = await Promise.all(
        (req.headers ?? []).map(async (h) => ({
          ...h,
          value: await resolveTemplate(h.value, vars, fns),
        })),
      )
      const resolvedBody = await resolveBody(ctx, req.body)

      let urlWithAuth = resolvedUrl
      let authOverride: AuthConfig | undefined
      const workspace = useUiStore
        .getState()
        .workspaces.find((w) => w.id === workspaceId)
      if (workspace) {
        const { auth } = resolveInheritedAuthAnnotated(
          req,
          useRequestStore.getState().folders,
          workspace,
        )
        const applied = await applyAuthForSend(ctx, auth, workspaceId, true)
        resolvedHeaders.push(...applied.headers)
        if (applied.query)
          urlWithAuth += (urlWithAuth.includes("?") ? "&" : "?") + applied.query
        authOverride = applied.dynamicAuthOverride
      }

      const t0 = Date.now()
      const sendRes = await sendRequestCommand(workspaceId, requestId, {
        urlOverride: urlWithAuth,
        headersOverride: resolvedHeaders,
        bodyOverride: resolvedBody,
        authOverride,
        calledFrom: callerName,
      })
      const elapsed = Date.now() - t0

      if (sendRes.status !== "ok") {
        const err = sendRes.error
        const msg = "data" in err ? String(err.data) : err.kind
        pendingPreflightEvents.push({
          label: "Pre-flight",
          source: req.name,
          result: `failed: ${msg}`,
        })
        throw new Error(`Pre-flight request failed: ${msg}`)
      }

      pendingPreflightEvents.push({
        label: "Pre-flight",
        source: req.name,
        result: `${sendRes.data.status} ${sendRes.data.statusText} (${elapsed}ms)`,
      })

      // Notify the UI so the source request's history panel refreshes.
      void emit("response:stored", { workspaceId, requestId })
    } finally {
      unmarkResolving(requestId)
    }
  }
}
