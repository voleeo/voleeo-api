import type {
  AuthConfig,
  RequestBody,
  RequestParameter,
} from "../../../packages/types/bindings"

/** Flags that take a value but whose value we don't care about; we still need
 *  to consume the next token so we don't misinterpret it as the URL. */
export const SKIP_VALUE_FLAGS = new Set([
  "--cacert",
  "--cert",
  "--cert-type",
  "--connect-timeout",
  "--cookie",
  "--cookie-jar",
  "--key",
  "--key-type",
  "--max-time",
  "--proxy",
  "--proxy-user",
  "--referer",
  "--resolve",
  "--user-agent",
  "-A",
  "-b",
  "-c",
  "-e",
  "-m",
  "-x",
])

/** Boolean flags we just discard. */
export const SKIP_BOOL_FLAGS = new Set([
  "-#",
  "-I",
  "-L",
  "-O",
  "-S",
  "-f",
  "-i",
  "-k",
  "-s",
  "-v",
  "--compressed",
  "--fail",
  "--head",
  "--include",
  "--insecure",
  "--location",
  "--no-progress-meter",
  "--progress-bar",
  "--silent",
  "--show-error",
  "--verbose",
])

export function detectBodyKind(
  body: string,
  headers: RequestParameter[],
): RequestBody["kind"] {
  const ct = headers
    .find((h) => h.name.toLowerCase() === "content-type")
    ?.value.toLowerCase()
  if (ct?.includes("json")) return "json"
  if (ct?.includes("xml")) return "xml"
  if (ct?.includes("text")) return "text"
  // Fall back to sniffing the literal.
  const trimmed = body.trimStart()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(body)
      return "json"
    } catch {
      // not valid JSON, continue
    }
  }
  if (trimmed.startsWith("<")) return "xml"
  return "text"
}

export function deriveAuth(
  headers: RequestParameter[],
  basicCreds: string | null,
): { auth: AuthConfig; consumedHeaderIndex: number | null } {
  if (basicCreds) {
    const idx = basicCreds.indexOf(":")
    const username = idx < 0 ? basicCreds : basicCreds.slice(0, idx)
    const password = idx < 0 ? "" : basicCreds.slice(idx + 1)
    return {
      auth: { kind: "basic", username, password },
      consumedHeaderIndex: null,
    }
  }
  const authIdx = headers.findIndex(
    (h) => h.name.toLowerCase() === "authorization",
  )
  if (authIdx < 0) return { auth: { kind: "none" }, consumedHeaderIndex: null }
  const raw = headers[authIdx].value
  const m = raw.match(/^Bearer\s+(.+)$/i)
  if (m) {
    return {
      auth: { kind: "bearer", token: m[1] },
      consumedHeaderIndex: authIdx,
    }
  }
  const basic = raw.match(/^Basic\s+(.+)$/i)
  if (basic) {
    try {
      // atob is available in browser + modern Node/bun
      const decoded = atob(basic[1])
      const idx = decoded.indexOf(":")
      const username = idx < 0 ? decoded : decoded.slice(0, idx)
      const password = idx < 0 ? "" : decoded.slice(idx + 1)
      return {
        auth: { kind: "basic", username, password },
        consumedHeaderIndex: authIdx,
      }
    } catch {
      // fall through
    }
  }
  return { auth: { kind: "none" }, consumedHeaderIndex: null }
}
