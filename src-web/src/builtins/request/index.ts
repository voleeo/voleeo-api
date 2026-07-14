// This module is intentionally in-tree (not a plugin-api plugin) because it
// depends on host state: the requests store and the environment store.
// Third-party plugins must use ctx.* instead.

import type {
  TemplateFunctionContribution,
  VoleeoPlugin,
} from "@voleeo/plugin-api"
import { extractBody, extractHeader } from "@/lib/extract"
import { resolveTemplate } from "@/lib/template"
import { useRequestStore } from "@/store/requests"
import {
  extractPathParams,
  queryParamsOnly,
} from "@/views/ApiWorkspace/paramUtils"
import type { HttpRequest } from "../../../../packages/types/bindings"
import { markResolving, unmarkResolving } from "../shared/cycleGuard"
import { envVars } from "../shared/envVars"

export function loadRequest(requestId: string): HttpRequest {
  const req = useRequestStore
    .getState()
    .requests.find((r) => r.id === requestId)
  if (!req) throw new Error(`Request not found: ${requestId}`)
  return req
}

export async function resolveValue(
  value: string,
  cycleKey: string,
): Promise<string> {
  if (!markResolving(cycleKey))
    throw new Error(`Cycle detected via request.*: ${cycleKey}`)
  try {
    // Lazy import to avoid the circular dep between registry → plugins → here.
    const { registry } = await import("@/plugins/registry")
    return await resolveTemplate(value, envVars(), registry.templateFunctions())
  } finally {
    unmarkResolving(cycleKey)
  }
}

const REQUEST_ID_ARG = {
  name: "requestId",
  label: "Source request",
  type: "text" as const,
  required: true,
}

const templateFunctions: TemplateFunctionContribution[] = [
  {
    name: "request.path",
    label: "Request path param",
    description: "Read a :name path parameter from another request",
    args: [
      REQUEST_ID_ARG,
      { name: "name", label: "Param name", type: "text", required: true },
    ],
    onRender: async (_ctx, args) => {
      const { requestId, name } = args
      if (!requestId) throw new Error("request.path: requestId is required")
      if (!name) throw new Error("request.path: name is required")
      const req = loadRequest(requestId)
      if (!extractPathParams(req.url).includes(name))
        throw new Error(`Path param "${name}" not found in ${req.name}`)
      const param = (req.parameters ?? []).find(
        (p) => p.name === name && p.enabled !== false,
      )
      return resolveValue(
        param?.value ?? "",
        `request.path:${requestId}:${name}`,
      )
    },
  },
  {
    name: "request.query",
    label: "Request query param",
    description: "Read a query-string parameter from another request",
    args: [
      REQUEST_ID_ARG,
      { name: "name", label: "Param name", type: "text", required: true },
    ],
    onRender: async (_ctx, args) => {
      const { requestId, name } = args
      if (!requestId) throw new Error("request.query: requestId is required")
      if (!name) throw new Error("request.query: name is required")
      const req = loadRequest(requestId)
      const queries = queryParamsOnly(req.parameters ?? [], req.url)
      const param = queries.find((p) => p.name === name && p.enabled !== false)
      if (!param)
        throw new Error(`Query param "${name}" not found in ${req.name}`)
      return resolveValue(param.value, `request.query:${requestId}:${name}`)
    },
  },
  {
    name: "request.header",
    label: "Request header",
    description: "Read a header value from another request",
    args: [
      REQUEST_ID_ARG,
      { name: "name", label: "Header name", type: "text", required: true },
    ],
    onRender: async (_ctx, args) => {
      const { requestId, name } = args
      if (!requestId) throw new Error("request.header: requestId is required")
      if (!name) throw new Error("request.header: name is required")
      const req = loadRequest(requestId)
      const enabledHeaders = (req.headers ?? []).filter(
        (h) => h.enabled !== false,
      )
      const value = extractHeader(enabledHeaders, name, {
        caseInsensitive: true,
      })
      return resolveValue(
        value,
        `request.header:${requestId}:${name.toLowerCase()}`,
      )
    },
  },
  {
    name: "request.body",
    label: "Request body",
    description:
      "Read the body of another request (plain text, JSONPath, or XPath)",
    args: [
      REQUEST_ID_ARG,
      { name: "selector", label: "Selector", type: "text", defaultValue: "" },
    ],
    onRender: async (_ctx, args) => {
      const { requestId, selector } = args
      if (!requestId) throw new Error("request.body: requestId is required")
      const req = loadRequest(requestId)
      const body = req.body?.text ?? ""
      const extracted = extractBody(body, selector ?? "")
      return resolveValue(extracted, `request.body:${requestId}`)
    },
  },
]

export const requestBuiltin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/builtin-request",
    name: "Request Functions",
    version: "1.0.0",
    author: "Voleeo",
  },
  templateFunctions,
}
