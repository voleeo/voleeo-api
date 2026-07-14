import type {
  TemplateFunctionContribution,
  VoleeoPlugin,
} from "@voleeo/plugin-api"
import { extractBody, extractHeader } from "@/lib/extract"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { buildSender, pendingPreflightEvents } from "./preflightSender"
import {
  clearResponseCycleCache,
  ensureResponse,
  type ResponseStrategy,
} from "./strategy"

export { clearResponseCycleCache, pendingPreflightEvents }

const STRATEGY_DEFAULT: ResponseStrategy = "cache"
const TTL_DEFAULT = 60

/** Shared setup for the response.* functions: validate requestId + active
 *  workspace, then run/reuse the source request's response per strategy. */
async function resolveResponseFor(
  fnName: string,
  args: { requestId?: string; strategy?: string; ttl?: string },
) {
  const { requestId, strategy, ttl } = args
  if (!requestId) throw new Error(`${fnName}: requestId is required`)
  const workspaceId = useUiStore.getState().activeWorkspaceId
  if (!workspaceId) throw new Error(`${fnName}: no active workspace`)
  const { activeRequestId, requests } = useRequestStore.getState()
  const callerName =
    requests.find((r) => r.id === activeRequestId)?.name ?? "Unknown request"
  return ensureResponse(
    workspaceId,
    requestId,
    (strategy as ResponseStrategy) ?? STRATEGY_DEFAULT,
    ttl ? Number(ttl) : TTL_DEFAULT,
    buildSender(callerName),
  )
}

const templateFunctions: TemplateFunctionContribution[] = [
  {
    name: "response.body",
    label: "Response body",
    description:
      "Use the response body of another request (plain text, JSONPath, or XPath)",
    args: [
      {
        name: "requestId",
        label: "Source request",
        type: "text",
        required: true,
      },
      {
        name: "strategy",
        label: "Execution strategy",
        type: "select",
        defaultValue: STRATEGY_DEFAULT,
        options: [
          { label: "Cache — use stored response", value: "cache" },
          { label: "Refresh after TTL", value: "refresh-after" },
          { label: "Force — always re-run", value: "force" },
        ],
      },
      {
        name: "ttl",
        label: "TTL (seconds)",
        type: "text",
        defaultValue: String(TTL_DEFAULT),
      },
      { name: "selector", label: "Selector", type: "text", defaultValue: "" },
    ],
    onRender: async (_ctx, args) => {
      const stored = await resolveResponseFor("response.body", args)
      return extractBody(stored.response.body, args.selector ?? "")
    },
  },
  {
    name: "response.header",
    label: "Response header",
    description: "Use a response header value from another request",
    args: [
      {
        name: "requestId",
        label: "Source request",
        type: "text",
        required: true,
      },
      {
        name: "strategy",
        label: "Execution strategy",
        type: "select",
        defaultValue: STRATEGY_DEFAULT,
        options: [
          { label: "Cache — use stored response", value: "cache" },
          { label: "Refresh after TTL", value: "refresh-after" },
          { label: "Force — always re-run", value: "force" },
        ],
      },
      {
        name: "ttl",
        label: "TTL (seconds)",
        type: "text",
        defaultValue: String(TTL_DEFAULT),
      },
      { name: "name", label: "Header name", type: "text", required: true },
    ],
    onRender: async (_ctx, args) => {
      if (!args.name) throw new Error("response.header: name is required")
      const stored = await resolveResponseFor("response.header", args)
      return extractHeader(stored.response.headers, args.name)
    },
  },
]

export const responseBuiltin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/builtin-response",
    name: "Response Functions",
    version: "1.0.0",
    author: "Voleeo",
  },
  templateFunctions,
}
