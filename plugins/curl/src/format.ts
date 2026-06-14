/** A cURL request with concrete values — templates resolved, query folded into
 *  `url`, auth applied. Built by the plugin's `serializeAsCurl` and by the
 *  app's post-send inspector, so both render identically via `formatCurl`. */
export interface CurlRequest {
  method: string
  url: string
  headers: CurlHeader[]
  body?: { kind: string; text: string }
  /** Emitted as `-u user:pass`; absent when auth is already in `headers`. */
  basicAuth?: { username: string; password: string }
  /** Emitted as `--digest -u user:pass` — cURL runs the challenge-response. */
  digestAuth?: { username: string; password: string }
  /** Emitted as `--ntlm -u user:pass` — username may be `DOMAIN\user`. */
  ntlmAuth?: { username: string; password: string }
  cookies?: CurlCookie[]
}

export interface CurlHeader {
  name: string
  value: string
}

export interface CurlCookie {
  name: string
  value: string
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

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

/** Render a resolved `CurlRequest` as a POSIX/bash cURL command. */
export function formatCurl(req: CurlRequest): string {
  const headers = [...req.headers]

  const bodyLines: string[] = []
  if (req.body?.text) {
    const implicit = contentTypeFor(req.body.kind)
    const hasContentType = headers.some(
      (h) => h.name.toLowerCase() === "content-type",
    )
    if (implicit && !hasContentType) {
      headers.unshift({ name: "Content-Type", value: implicit })
    }
    bodyLines.push(`--data-raw ${shellQuote(req.body.text)}`)
  }

  const headerLines = headers.map(
    (h) => `-H ${shellQuote(`${h.name}: ${h.value}`)}`,
  )

  const credFlag = (
    mode: "--digest" | "--ntlm" | null,
    cred: { username: string; password: string },
  ) => [
    ...(mode ? [mode] : []),
    `-u ${shellQuote(`${cred.username}:${cred.password}`)}`,
  ]
  const authFlags = req.digestAuth
    ? credFlag("--digest", req.digestAuth)
    : req.ntlmAuth
      ? credFlag("--ntlm", req.ntlmAuth)
      : req.basicAuth
        ? credFlag(null, req.basicAuth)
        : []

  const cookieLines =
    req.cookies && req.cookies.length > 0
      ? [
          `-b ${shellQuote(
            req.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
          )}`,
        ]
      : []

  const hasBody = bodyLines.length > 0
  const headSegments = ["curl"]
  if (req.method !== "GET" || hasBody) headSegments.push(`-X ${req.method}`)
  headSegments.push(shellQuote(req.url))

  const rest = [...headerLines, ...authFlags, ...cookieLines, ...bodyLines]
  const head = headSegments.join(" ")
  if (rest.length === 0) return head
  return [head, ...rest.map((p) => `  ${p}`)].join(" \\\n")
}
