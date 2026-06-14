import type { HttpRequest, RequestBody } from "@/store/requests"
import type {
  HeaderOrigin,
  SentHeader,
  SentRequestSnapshot,
} from "../SentRequestInspector/types"
import type { ResolvedSendPayload } from "./types"

/** Readable rendering of a resolved body for the sent-request inspector. */
function bodyDisplayText(body: RequestBody): string {
  switch (body.kind) {
    case "form_url_encoded":
      return (body.fields ?? [])
        .filter((f) => f.enabled && f.name.trim())
        .map((f) => `${f.name}=${f.value}`)
        .join("\n")
    case "multipart":
      return (body.fields ?? [])
        .filter((f) => f.enabled && f.name.trim())
        .map((f) => `${f.name}: ${f.isFile ? `@${f.value}` : f.value}`)
        .join("\n")
    case "binary":
      return body.filePath ? `[binary] ${body.filePath}` : "[binary]"
    case "graphql": {
      let variables: unknown = null
      try {
        if (body.graphqlVariables?.trim())
          variables = JSON.parse(body.graphqlVariables)
      } catch {
        variables = null
      }
      return JSON.stringify({ query: body.text ?? "", variables }, null, 2)
    }
    default:
      return body.text ?? ""
  }
}

/** Read-only "what was sent" snapshot, from the same data `resolveSendPayload`
 *  produced. Feeds the sent-request inspector and the Timing tab summary. */
export function buildSentSnapshot(args: {
  request: HttpRequest
  payload: ResolvedSendPayload
  capturedAt: number | null
  signedAuthHeaders?: { name: string; value: string }[]
}): SentRequestSnapshot {
  const { request, payload, capturedAt, signedAuthHeaders } = args
  const auth = payload.resolvedAuth

  // `headerOrigins` is parallel to the merged headers by index; anything past it
  // was appended by the auth step. Match by index — names can collide.
  const headers: SentHeader[] = []
  payload.headers.forEach((h, idx) => {
    const ann = payload.headerOrigins[idx]
    const origin: HeaderOrigin = !ann
      ? { kind: "auth" }
      : ann.origin === "folder"
        ? { kind: "folder", folderName: ann.folderName ?? "" }
        : ann.origin === "workspace"
          ? { kind: "workspace" }
          : { kind: "request" }
    headers.push({ name: h.name, value: h.value, origin })
  })

  // Dynamic-auth signature headers (Authorization, x-amz-date, …) are computed
  // backend-side; surface them as auth-origin rows.
  for (const h of signedAuthHeaders ?? []) {
    headers.push({ name: h.name, value: h.value, origin: { kind: "auth" } })
  }

  const authSummary = (() => {
    switch (auth.kind) {
      case "none":
        return "No authentication"
      case "bearer":
        return "Bearer token"
      case "basic":
        return `Basic (${auth.username || "—"})`
      case "api_key":
        return `API key (${auth.key || "—"} in ${auth.location})`
      case "aws_sig_v4": {
        // Prefer the template-resolved config so the summary shows real values.
        const sig =
          payload.dynamicAuthOverride?.kind === "aws_sig_v4"
            ? payload.dynamicAuthOverride
            : auth
        return `AWS SigV4 (${sig.region || "—"}/${sig.service || "—"})`
      }
      case "oauth1":
        return `OAuth 1.0 (${auth.consumer_key || "—"})`
      case "oauth2":
        return `OAuth 2.0 (${auth.grant_type})`
      case "digest":
        return `Digest (${auth.username || "—"})`
      case "inherit":
        return "Inherited (no folder or workspace defined an auth)"
    }
  })()

  return {
    capturedAt,
    method: request.method,
    fullUrl: payload.fullUrl,
    headers,
    body: payload.body
      ? { kind: payload.body.kind, text: bodyDisplayText(payload.body) }
      : undefined,
    cookies: (payload.cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    })),
    resolvedAuth: {
      kind: auth.kind,
      summary: authSummary,
      apiKeyLocation: auth.kind === "api_key" ? auth.location : undefined,
      inheritedFromFolderId: payload.inheritedAuthFolderId,
      inheritedFromFolderName: payload.inheritedAuthFolderName,
      inheritedFromWorkspace: payload.inheritedAuthFromWorkspace,
    },
  }
}
