import { emit } from "@tauri-apps/api/event"
import { EVENTS } from "@/config/events"
import type { ResolutionEvent } from "@/lib/template"
import { resolveTemplate } from "@/lib/template"
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
import { envVars } from "../shared/envVars"
import { markResolving, type RequestSender, unmarkResolving } from "./strategy"

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

      const vars = envVars()

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
      void emit(EVENTS.responseStored, { workspaceId, requestId })
    } finally {
      unmarkResolving(requestId)
    }
  }
}
