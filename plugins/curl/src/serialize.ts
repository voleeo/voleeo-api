import type { Context } from "@voleeo/plugin-api"
import type {
  AuthConfig,
  HttpRequest,
  RequestParameter,
} from "@voleeo/types/bindings"
import { type CurlHeader, type CurlRequest, formatCurl } from "./format"

function extractPathParamNames(url: string): string[] {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split("?")[0].split("#")[0]
  }
  return [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1])
}

function substitutePathParams(
  url: string,
  pathParams: Map<string, { value: string; enabled: boolean }>,
): string {
  return url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_full, name: string) => {
    const param = pathParams.get(name)
    if (!param || !param.enabled) return ""
    return encodeURIComponent(param.value)
  })
}

function appendQuery(url: string, qs: string): string {
  if (!qs) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}${qs}`
}

async function resolveStr(ctx: Context, value: string): Promise<string> {
  return ctx.templates.render(value)
}

async function resolveParams(
  ctx: Context,
  params: RequestParameter[],
): Promise<Array<{ name: string; value: string; enabled: boolean }>> {
  // Disabled rows skip template resolution entirely — matches Send behavior
  // and avoids firing side-effecting templates (ask(), prompts) for rows the
  // user has deliberately turned off.
  return Promise.all(
    params.map(async (p) =>
      p.enabled
        ? {
            name: await resolveStr(ctx, p.name),
            value: await resolveStr(ctx, p.value),
            enabled: true,
          }
        : { name: p.name, value: p.value, enabled: false },
    ),
  )
}

interface AuthParts {
  headers: CurlHeader[]
  query: Array<{ name: string; value: string }>
  basicAuth?: { username: string; password: string }
  digestAuth?: { username: string; password: string }
}

function authDisabled(auth: AuthConfig | undefined): boolean {
  return !!auth && "enabled" in auth && auth.enabled === false
}

/** Dynamic schemes the host signs over the final request (SigV4, OAuth 1.0). */
function isSignedScheme(auth: AuthConfig | undefined): boolean {
  return (
    !!auth &&
    (auth.kind === "aws_sig_v4" || auth.kind === "oauth1") &&
    !authDisabled(auth)
  )
}

async function buildAuthParts(
  ctx: Context,
  auth: AuthConfig | undefined,
): Promise<AuthParts> {
  const headers: CurlHeader[] = []
  const query: Array<{ name: string; value: string }> = []
  if (!auth || auth.kind === "none" || authDisabled(auth))
    return { headers, query }
  if (auth.kind === "bearer") {
    const token = await resolveStr(ctx, auth.token)
    headers.push({ name: "Authorization", value: `Bearer ${token}` })
  } else if (auth.kind === "basic") {
    return {
      headers,
      query,
      basicAuth: {
        username: await resolveStr(ctx, auth.username),
        password: await resolveStr(ctx, auth.password),
      },
    }
  } else if (auth.kind === "api_key") {
    const name = await resolveStr(ctx, auth.key)
    const value = await resolveStr(ctx, auth.value)
    if (auth.location === "header") headers.push({ name, value })
    else query.push({ name, value })
  } else if (auth.kind === "digest") {
    return {
      headers,
      query,
      digestAuth: {
        username: await resolveStr(ctx, auth.username),
        password: await resolveStr(ctx, auth.password ?? ""),
      },
    }
  }
  return { headers, query }
}

/** Resolve a stored `HttpRequest` into a concrete `CurlRequest`: render
 *  templates, split path-params from query-params, fold auth into headers /
 *  query / basicAuth. */
async function resolve(
  request: HttpRequest,
  ctx: Context,
): Promise<CurlRequest> {
  const pathNames = new Set(extractPathParamNames(request.url))
  const allParams = await resolveParams(ctx, request.parameters ?? [])
  const pathParamMap = new Map<string, { value: string; enabled: boolean }>()
  const queryParams: Array<{ name: string; value: string }> = []
  for (const p of allParams) {
    if (pathNames.has(p.name)) {
      pathParamMap.set(p.name, { value: p.value, enabled: p.enabled })
    } else if (p.enabled && p.name) {
      queryParams.push({ name: p.name, value: p.value })
    }
  }

  let url = await resolveStr(ctx, request.url)
  url = substitutePathParams(url, pathParamMap)

  const auth = await buildAuthParts(ctx, request.auth)

  const qs = [...queryParams, ...auth.query]
    .map((q) =>
      q.value
        ? `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`
        : encodeURIComponent(q.name),
    )
    .join("&")
  url = appendQuery(url, qs)

  const headers = (await resolveParams(ctx, request.headers ?? []))
    .filter((h) => h.enabled && h.name)
    .map((h) => ({ name: h.name, value: h.value }))

  const body =
    request.body && request.body.kind !== "none" && request.body.text
      ? {
          kind: request.body.kind,
          text: await resolveStr(ctx, request.body.text),
        }
      : undefined

  const method = (request.method ?? "GET").toUpperCase()
  // Dynamic schemes (AWS SigV4, OAuth 1.0) are signed by the host over the final
  // request — into headers and/or the query string.
  const signed = isSignedScheme(request.auth)
    ? await ctx.auth.signDynamic(await ctx.templates.render(request.auth), {
        method,
        url,
        body,
      })
    : { headers: [], query: [] }

  const signedQs = signed.query
    .map(
      (q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`,
    )
    .join("&")
  const finalUrl = appendQuery(url, signedQs)

  return {
    method,
    url: finalUrl,
    headers: [...headers, ...auth.headers, ...signed.headers],
    body,
    basicAuth: auth.basicAuth,
    digestAuth: auth.digestAuth,
  }
}

/** Serialize an `HttpRequest` as a POSIX/bash cURL command. Templates are
 *  resolved via `ctx.templates.render` so the output is runnable as-is. */
export async function serializeAsCurl(
  request: HttpRequest,
  ctx: Context,
): Promise<string> {
  return formatCurl(await resolve(request, ctx))
}
