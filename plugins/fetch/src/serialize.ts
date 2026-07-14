import type { Context } from "@voleeo/plugin-api"
import {
  appendQuery,
  authDisabled,
  extractPathParamNames,
  isSignedScheme,
  resolveParams,
  resolveStr,
  substitutePathParams,
} from "@voleeo/plugin-api/request"
import type { AuthConfig, HttpRequest } from "@voleeo/types/bindings"

function contentTypeFor(kind: string): string | null {
  switch (kind) {
    case "json":
      return "application/json"
    case "xml":
      return "application/xml"
    case "text":
      return "text/plain"
    default:
      return null
  }
}

async function buildAuthParts(
  ctx: Context,
  auth: AuthConfig | undefined,
): Promise<{
  extraHeaders: Array<{ name: string; value: string }>
  extraQuery: Array<{ name: string; value: string }>
  basicAuth: { user: string; pass: string } | null
  note?: string
}> {
  const extraHeaders: Array<{ name: string; value: string }> = []
  const extraQuery: Array<{ name: string; value: string }> = []
  let basicAuth: { user: string; pass: string } | null = null
  if (!auth || auth.kind === "none" || authDisabled(auth))
    return { extraHeaders, extraQuery, basicAuth }
  if (auth.kind === "bearer") {
    const token = await resolveStr(ctx, auth.token)
    extraHeaders.push({ name: "Authorization", value: `Bearer ${token}` })
  } else if (auth.kind === "basic") {
    basicAuth = {
      user: await resolveStr(ctx, auth.username),
      pass: await resolveStr(ctx, auth.password),
    }
  } else if (auth.kind === "api_key") {
    const key = await resolveStr(ctx, auth.key)
    const value = await resolveStr(ctx, auth.value)
    if (auth.location === "header") extraHeaders.push({ name: key, value })
    else extraQuery.push({ name: key, value })
  } else if (auth.kind === "digest") {
    // fetch() has no Digest support — it can't run the 401 challenge-response.
    return {
      extraHeaders,
      extraQuery,
      basicAuth,
      note: "Digest auth omitted — fetch() can't perform the challenge-response. Use curl --digest or a digest-capable HTTP client.",
    }
  } else if (auth.kind === "ntlm") {
    // fetch() can't do the NTLM connection handshake.
    return {
      extraHeaders,
      extraQuery,
      basicAuth,
      note: "NTLM auth omitted — fetch() can't perform the NTLM handshake. Use curl --ntlm.",
    }
  }
  return { extraHeaders, extraQuery, basicAuth }
}

/** Serialize an HttpRequest as a runnable JavaScript fetch() snippet using
 *  top-level async/await. Templates are resolved via `ctx.templates.render`. */
export async function serializeAsFetch(
  request: HttpRequest,
  ctx: Context,
): Promise<string> {
  const pathNames = new Set(extractPathParamNames(request.url))
  const allParams = await resolveParams(ctx, request.parameters ?? [])
  const pathParamMap = new Map<string, { value: string; enabled: boolean }>()
  const queryParams: Array<{ name: string; value: string; enabled: boolean }> =
    []
  for (const p of allParams) {
    if (pathNames.has(p.name))
      pathParamMap.set(p.name, { value: p.value, enabled: p.enabled })
    else queryParams.push(p)
  }

  let url = await resolveStr(ctx, request.url)
  url = substitutePathParams(url, pathParamMap)

  const auth = await buildAuthParts(ctx, request.auth)

  const queryRows = [
    ...queryParams.filter((p) => p.enabled && p.name),
    ...auth.extraQuery.map((q) => ({ ...q, enabled: true })),
  ]
  const qs = queryRows
    .map((q) =>
      q.value
        ? `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`
        : encodeURIComponent(q.name),
    )
    .join("&")
  url = appendQuery(url, qs)

  // Headers — merged with auth-derived headers. Use a Map keyed by
  // lowercased name to dedupe.
  const headerRows = await resolveParams(ctx, request.headers ?? [])
  const headerPairs: Array<[string, string]> = []
  const headerLower = new Set<string>()
  for (const h of headerRows) {
    if (!h.enabled || !h.name) continue
    headerPairs.push([h.name, h.value])
    headerLower.add(h.name.toLowerCase())
  }
  for (const h of auth.extraHeaders) {
    headerPairs.push([h.name, h.value])
    headerLower.add(h.name.toLowerCase())
  }

  // Body handling. JSON: try to parse the literal so we emit
  // JSON.stringify(<object>) when possible — keeps the snippet legible
  // and stable across whitespace.
  const method = (request.method ?? "GET").toUpperCase()
  let bodyLine: string | null = null
  if (request.body && request.body.kind !== "none" && request.body.text) {
    const rawBody = await resolveStr(ctx, request.body.text)
    const implicit = contentTypeFor(request.body.kind)
    if (implicit && !headerLower.has("content-type")) {
      headerPairs.unshift(["Content-Type", implicit])
    }
    if (request.body.kind === "json") {
      try {
        const parsed = JSON.parse(rawBody)
        bodyLine = `JSON.stringify(${JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ")})`
      } catch {
        bodyLine = JSON.stringify(rawBody)
      }
    } else {
      bodyLine = JSON.stringify(rawBody)
    }
  }

  // Dynamic schemes (AWS SigV4, OAuth 1.0) are signed by the host over the final
  // request — into headers and/or the query string.
  if (isSignedScheme(request.auth)) {
    const signBody =
      request.body && request.body.kind !== "none" && request.body.text
        ? {
            kind: request.body.kind,
            text: await resolveStr(ctx, request.body.text),
          }
        : undefined
    const signed = await ctx.auth.signDynamic(
      await ctx.templates.render(request.auth),
      { method, url, body: signBody },
    )
    for (const h of signed.headers) headerPairs.push([h.name, h.value])
    if (signed.query.length > 0) {
      url = appendQuery(
        url,
        signed.query
          .map(
            (q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`,
          )
          .join("&"),
      )
    }
  }

  const lines: string[] = []
  if (auth.note) lines.push(`// ${auth.note}`)
  lines.push(`const url = ${JSON.stringify(url)}`)
  lines.push("const response = await fetch(url, {")
  lines.push(`  method: ${JSON.stringify(method)},`)
  if (headerPairs.length > 0 || auth.basicAuth) {
    lines.push("  headers: {")
    if (auth.basicAuth) {
      const creds = `${auth.basicAuth.user}:${auth.basicAuth.pass}`
      lines.push(
        `    "Authorization": "Basic " + btoa(${JSON.stringify(creds)}),`,
      )
    }
    for (const [name, value] of headerPairs) {
      lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
    }
    lines.push("  },")
  }
  if (bodyLine) {
    lines.push(`  body: ${bodyLine},`)
  }
  lines.push("})")
  lines.push("const data = await response.json()")
  return lines.join("\n")
}
