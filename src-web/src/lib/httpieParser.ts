import type {
  AuthConfig,
  RequestBody,
  RequestParameter,
} from "../../../packages/types/bindings"
import type { ParsedRequest } from "./curlParser"
import { shellTokenize } from "./shellTokenize"

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "QUERY",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
])

function genId(name: string): string {
  return `imp_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Math.random().toString(36).slice(2, 8)}`
}

/** Heuristic: does the token look like a URL? */
function looksLikeUrl(s: string): boolean {
  return (
    /^https?:\/\//i.test(s) || /^localhost(:|\/)/.test(s) || s.startsWith(":")
  )
}

function isHeaderToken(s: string): boolean {
  // `Name:value` but NOT `Name:=json` (which would match `=` after the colon).
  // Also exclude `name==value` (query) tokens.
  if (s.includes("==")) return false
  const colonIdx = s.indexOf(":")
  if (colonIdx <= 0) return false
  // `:=` is a body raw-JSON token, not a header
  if (s[colonIdx + 1] === "=") return false
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(s.slice(0, colonIdx))
}

/** Parse a `http …` (HTTPie) command line into a Voleeo request shape.
 *  Returns `null` if the input doesn't look like HTTPie. */
export function parseHttpieCommand(input: string): ParsedRequest | null {
  const tokens = shellTokenize(input)
  if (!tokens || tokens.length === 0) return null
  // Accept both `http` and `https` (HTTPie's auto-https shortcut) at position 0.
  if (tokens[0] !== "http" && tokens[0] !== "https") return null

  let method: string | null = null
  let url: string | null = null
  const headers: RequestParameter[] = []
  const queryParams: RequestParameter[] = []
  const jsonFields: Array<{ key: string; value: unknown; raw: boolean }> = []
  let rawBody: string | null = null
  let basicCreds: string | null = null
  let forceJson = false
  let forceForm = false

  let i = 1
  while (i < tokens.length) {
    const t = tokens[i]

    // Flags
    if (t === "-a" || t === "--auth") {
      basicCreds = tokens[++i] ?? null
      i++
      continue
    }
    if (t === "--raw") {
      rawBody = tokens[++i] ?? ""
      i++
      continue
    }
    if (t === "--json" || t === "-j") {
      forceJson = true
      i++
      continue
    }
    if (t === "--form" || t === "-f") {
      forceForm = true
      i++
      continue
    }
    if (t === "-A" || t === "--auth-type") {
      i += 2 // skip value (e.g. basic / digest / bearer)
      continue
    }
    if (t.startsWith("-")) {
      // Skip unknown flags. Two-token forms could swallow URL — acceptable
      // trade-off for an unknown flag.
      i++
      continue
    }

    // First positional that matches an HTTP verb → method.
    if (method === null && HTTP_METHODS.has(t.toUpperCase())) {
      method = t.toUpperCase()
      i++
      continue
    }

    // Otherwise, first URL-looking positional → URL.
    if (url === null && looksLikeUrl(t)) {
      url = t
      i++
      continue
    }

    // Otherwise, classify by HTTPie token syntax.
    if (t.includes("==")) {
      const idx = t.indexOf("==")
      const name = t.slice(0, idx)
      const value = t.slice(idx + 2)
      if (name)
        queryParams.push({ id: genId(name), name, value, enabled: true })
      i++
      continue
    }

    if (isHeaderToken(t)) {
      const idx = t.indexOf(":")
      const name = t.slice(0, idx)
      const value = t.slice(idx + 1)
      headers.push({ id: genId(name), name, value, enabled: true })
      i++
      continue
    }

    if (t.includes(":=")) {
      const idx = t.indexOf(":=")
      const key = t.slice(0, idx)
      const rawJson = t.slice(idx + 2)
      try {
        const parsed = JSON.parse(rawJson)
        jsonFields.push({ key, value: parsed, raw: true })
      } catch {
        // Bad raw-JSON token — treat as string field
        jsonFields.push({ key, value: rawJson, raw: false })
      }
      i++
      continue
    }

    if (t.includes("=")) {
      const idx = t.indexOf("=")
      const key = t.slice(0, idx)
      const value = t.slice(idx + 1)
      jsonFields.push({ key, value, raw: false })
      i++
      continue
    }

    // Lone unrecognised positional — treat as URL if we don't have one.
    if (url === null) {
      url = t
      i++
      continue
    }

    // Otherwise drop it.
    i++
  }

  if (!url) return null

  // Body assembly.
  let body: RequestBody | null = null
  if (rawBody !== null) {
    body = {
      kind: forceJson ? "json" : sniffKind(rawBody),
      text: rawBody,
    }
  } else if (jsonFields.length > 0) {
    if (forceForm) {
      const form = jsonFields
        .map(
          (f) =>
            `${encodeURIComponent(f.key)}=${encodeURIComponent(String(f.value))}`,
        )
        .join("&")
      body = { kind: "text", text: form }
    } else {
      const obj: Record<string, unknown> = {}
      for (const f of jsonFields) obj[f.key] = f.value
      body = { kind: "json", text: JSON.stringify(obj) }
    }
  }

  // Auth.
  let auth: AuthConfig = { kind: "none" }
  let bearerHeaderIdx = -1
  if (basicCreds) {
    const idx = basicCreds.indexOf(":")
    auth = {
      kind: "basic",
      username: idx < 0 ? basicCreds : basicCreds.slice(0, idx),
      password: idx < 0 ? "" : basicCreds.slice(idx + 1),
    }
  } else {
    const authIdx = headers.findIndex(
      (h) => h.name.toLowerCase() === "authorization",
    )
    if (authIdx >= 0) {
      const v = headers[authIdx].value
      const bearer = v.match(/^Bearer\s+(.+)$/i)
      if (bearer) {
        auth = { kind: "bearer", token: bearer[1] }
        bearerHeaderIdx = authIdx
      }
    }
  }
  const finalHeaders =
    bearerHeaderIdx >= 0
      ? headers.filter((_, idx) => idx !== bearerHeaderIdx)
      : headers

  const finalMethod = method ?? (body ? "POST" : "GET")

  return {
    method: finalMethod,
    url,
    parameters: queryParams,
    headers: finalHeaders,
    body,
    auth,
  }
}

function sniffKind(body: string): RequestBody["kind"] {
  const t = body.trimStart()
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(body)
      return "json"
    } catch {
      // fallthrough
    }
  }
  if (t.startsWith("<")) return "xml"
  return "text"
}
