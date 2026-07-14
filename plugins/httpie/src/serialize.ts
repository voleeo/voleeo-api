import type { Context } from "@voleeo/plugin-api"
import {
  authDisabled,
  extractPathParamNames,
  isSignedScheme,
  resolveParams,
  resolveStr,
  shellQuote,
  substitutePathParams,
} from "@voleeo/plugin-api/request"
import type { AuthConfig, HttpRequest } from "@voleeo/types/bindings"

function contentTypeFor(kind: string): string | null {
  switch (kind) {
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
  flags: string[]
  extraHeaders: Array<{ name: string; value: string }>
  extraQuery: Array<{ name: string; value: string }>
  note?: string
}> {
  const flags: string[] = []
  const extraHeaders: Array<{ name: string; value: string }> = []
  const extraQuery: Array<{ name: string; value: string }> = []
  if (!auth || auth.kind === "none" || authDisabled(auth))
    return { flags, extraHeaders, extraQuery }
  if (auth.kind === "bearer") {
    const token = await resolveStr(ctx, auth.token)
    extraHeaders.push({ name: "Authorization", value: `Bearer ${token}` })
  } else if (auth.kind === "basic") {
    const user = await resolveStr(ctx, auth.username)
    const pass = await resolveStr(ctx, auth.password)
    flags.push(`-a ${shellQuote(`${user}:${pass}`)}`)
  } else if (auth.kind === "api_key") {
    const key = await resolveStr(ctx, auth.key)
    const value = await resolveStr(ctx, auth.value)
    if (auth.location === "header") extraHeaders.push({ name: key, value })
    else extraQuery.push({ name: key, value })
  } else if (auth.kind === "digest") {
    const user = await resolveStr(ctx, auth.username)
    const pass = await resolveStr(ctx, auth.password ?? "")
    // HTTPie runs the challenge-response itself with `--auth-type=digest`.
    flags.push("-A digest", `-a ${shellQuote(`${user}:${pass}`)}`)
  } else if (auth.kind === "ntlm") {
    // NTLM isn't built into HTTPie; surface a note rather than emit broken auth.
    return {
      flags,
      extraHeaders,
      extraQuery,
      note: "NTLM needs the httpie-ntlm plugin: -A ntlm -a 'DOMAIN\\user:pass'",
    }
  }
  return { flags, extraHeaders, extraQuery }
}

/** Encode a JSON value as the HTTPie raw-JSON token suffix (`:=`).
 *  Numbers/booleans/null/arrays/objects need `:=`; strings use `=`. */
function isFlatScalarObject(parsed: unknown): parsed is Record<string, unknown> {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every(
      (v) => v === null || typeof v !== "object" || Array.isArray(v),
    )
  )
}

/** Serialize an HttpRequest as a runnable HTTPie command using native syntax:
 *  `Name:value` for headers, `name==value` for query params, `field=value` for
 *  string body fields, `field:=<json>` for non-string body fields. */
export async function serializeAsHttpie(
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

  // HTTPie wants query params as positional `name==value` args, NOT appended
  // to the URL — keep the URL clean here.
  const queryArgs: string[] = []
  for (const q of queryParams) {
    if (!q.enabled || !q.name) continue
    queryArgs.push(shellQuote(`${q.name}==${q.value}`))
  }
  for (const q of auth.extraQuery) {
    queryArgs.push(shellQuote(`${q.name}==${q.value}`))
  }

  // Headers as `Name:value` positional args.
  const headerRows = await resolveParams(ctx, request.headers ?? [])
  const headerArgs: string[] = []
  const headerLower = new Set<string>()
  for (const h of headerRows) {
    if (!h.enabled || !h.name) continue
    headerArgs.push(shellQuote(`${h.name}:${h.value}`))
    headerLower.add(h.name.toLowerCase())
  }
  for (const h of auth.extraHeaders) {
    headerArgs.push(shellQuote(`${h.name}:${h.value}`))
    headerLower.add(h.name.toLowerCase())
  }

  // Body: JSON flat objects → `field=value` / `field:=<json>` tokens (most
  // idiomatic). Anything else → --raw '<text>'.
  const bodyArgs: string[] = []
  if (request.body && request.body.kind !== "none" && request.body.text) {
    const rawBody = await resolveStr(ctx, request.body.text)
    if (request.body.kind === "json") {
      let used = false
      try {
        const parsed = JSON.parse(rawBody)
        if (isFlatScalarObject(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") bodyArgs.push(shellQuote(`${k}=${v}`))
            else bodyArgs.push(shellQuote(`${k}:=${JSON.stringify(v)}`))
          }
          used = true
        }
      } catch {
        // fall through to --raw
      }
      if (!used) {
        bodyArgs.push(`--raw ${shellQuote(rawBody)}`)
      }
    } else {
      // xml/text: HTTPie defaults to JSON content-type unless we override.
      const ct = contentTypeFor(request.body.kind)
      if (ct && !headerLower.has("content-type")) {
        headerArgs.push(shellQuote(`Content-Type:${ct}`))
      }
      bodyArgs.push(`--raw ${shellQuote(rawBody)}`)
    }
  }

  const method = (request.method ?? "GET").toUpperCase()

  // Dynamic schemes (AWS SigV4) are signed by the host over the final request.
  // HTTPie keeps query params out of the URL, so rebuild the full URL to sign.
  if (isSignedScheme(request.auth)) {
    const queryForSign = [
      ...queryParams.filter((q) => q.enabled && q.name),
      ...auth.extraQuery,
    ]
      .map((q) =>
        q.value
          ? `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`
          : encodeURIComponent(q.name),
      )
      .join("&")
    const signUrl = queryForSign
      ? `${url}${url.includes("?") ? "&" : "?"}${queryForSign}`
      : url
    const signBody =
      request.body && request.body.kind !== "none" && request.body.text
        ? {
            kind: request.body.kind,
            text: await resolveStr(ctx, request.body.text),
          }
        : undefined
    const signed = await ctx.auth.signDynamic(
      await ctx.templates.render(request.auth),
      { method, url: signUrl, body: signBody },
    )
    for (const h of signed.headers) {
      headerArgs.push(shellQuote(`${h.name}:${h.value}`))
    }
    // HTTPie carries query params as positional `name==value` args.
    for (const q of signed.query) {
      queryArgs.push(shellQuote(`${q.name}==${q.value}`))
    }
  }

  // Head stays on the first line: `http [-a 'u:p'] METHOD 'url'`. Everything
  // positional (queries/headers/body) goes on continuation lines.
  const headSegments = ["http", ...auth.flags, method, shellQuote(url)]
  const rest = [...queryArgs, ...headerArgs, ...bodyArgs]
  const head = headSegments.join(" ")
  const command =
    rest.length === 0
      ? head
      : [head, ...rest.map((p) => `  ${p}`)].join(" \\\n")
  return auth.note ? `# ${auth.note}\n${command}` : command
}
