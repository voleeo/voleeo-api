import type { ResolutionEvent } from "@/lib/template"
import type {
  AuthConfig,
  RequestBody,
  RequestParameter,
  StoredCookie_Deserialize,
  TimelineEvent,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"

/** Pre-flight resolution observations rendered as `atMs: 0` Timeline events. */
export function resolutionToTimelineEvents(
  resolutions: ResolutionEvent[],
): TimelineEvent[] {
  return resolutions.map((r) => ({
    atMs: 0,
    kind: "resolve",
    text: `${r.label}: ${r.source} → ${JSON.stringify(r.result)}`,
  }))
}

export interface SendRequestOptions {
  urlOverride?: string | null
  bodyOverride?: RequestBody | null
  headersOverride?: RequestParameter[] | null
  calledFrom?: string | null
  resolutionNotes?: string[] | null
  environmentId?: string | null
  cookieOverrides?: StoredCookie_Deserialize[] | null
  authOverride?: AuthConfig | null
}

export function sendRequestCommand(
  workspaceId: string,
  requestId: string,
  opts: SendRequestOptions = {},
) {
  return commands.sendRequest(workspaceId, requestId, {
    url: opts.urlOverride ?? null,
    body: opts.bodyOverride ?? null,
    headers: opts.headersOverride ?? null,
    calledFrom: opts.calledFrom ?? null,
    resolutionNotes: opts.resolutionNotes ?? null,
    environmentId: opts.environmentId ?? null,
    cookieOverrides: opts.cookieOverrides ?? null,
    authOverride: opts.authOverride ?? null,
  })
}

/** Sign a resolved dynamic scheme (SigV4, OAuth 1.0); returns the header and/or
 *  query params it adds (OAuth 1.0 can place its params in either). Empty for
 *  static/no/disabled auth. Sole entry-point to `commands.signAuthHeaders`. */
export async function signAuthHeaders(
  auth: AuthConfig,
  method: string,
  url: string,
  body: RequestBody | null,
): Promise<{ headers: RequestParameter[]; query: RequestParameter[] }> {
  const res = await commands.signAuthHeaders(auth, method, url, body)
  return res.status === "ok" ? res.data : { headers: [], query: [] }
}
