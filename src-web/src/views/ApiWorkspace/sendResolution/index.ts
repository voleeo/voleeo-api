import { isAuthEnabled } from "@/lib/authSchemes"
import type { ResolutionLog } from "@/lib/template"
import { oauth2EnsureToken, resolveOAuth2Templates } from "@/store/oauth2"
import {
  mergeInheritedHeadersAnnotated,
  mergeInheritedVariables,
  resolveInheritedAuthAnnotated,
} from "./inheritance"
import {
  applyAuth,
  resolveBody,
  resolveCookies,
  resolveHeaders,
  resolveUrl,
} from "./steps"
import type { ResolvedSendPayload, ResolveSendInput } from "./types"

export {
  mergeEnvVars,
  mergeInheritedHeadersAnnotated,
  mergeInheritedVariables,
  resolveInheritedAuth,
  resolveInheritedAuthAnnotated,
} from "./inheritance"
export { buildSentSnapshot } from "./snapshot"
export type {
  AnnotatedHeader,
  ResolvedSendPayload,
  ResolveSendInput,
} from "./types"

/** Resolve a request to its over-the-wire form (URL, headers, body, cookies),
 *  templating every field and recording each substitution for the Timing tab. */
export async function resolveSendPayload(
  input: ResolveSendInput,
): Promise<ResolvedSendPayload> {
  const { request, folders, workspace, activeJar } = input
  // Folder vars layer over env so every {{ KEY }} below sees them.
  const vars = mergeInheritedVariables(request, folders, input.vars)
  const log: ResolutionLog = { events: [], label: "" }
  const ctx = { vars, fns: input.templateFns, log }

  let fullUrl = await resolveUrl(ctx, input)
  const headerOrigins = mergeInheritedHeadersAnnotated(
    request,
    folders,
    workspace,
  )
  const headers = await resolveHeaders(ctx, headerOrigins)
  const body = await resolveBody(ctx, request.body)

  const {
    auth,
    inheritedFromFolderId,
    inheritedFromFolderName,
    inheritedFromWorkspace,
  } = resolveInheritedAuthAnnotated(request, folders, workspace)
  const applied = await applyAuth(ctx, auth)
  headers.push(...applied.headers)
  if (applied.query)
    fullUrl += (fullUrl.includes("?") ? "&" : "?") + applied.query

  if (input.forSend && auth.kind === "oauth2" && isAuthEnabled(auth)) {
    const resolved = await resolveOAuth2Templates(auth, ctx.vars, ctx.fns)
    const token = await oauth2EnsureToken(workspace.id, resolved)
    headers.push({
      id: "__auth",
      name: "Authorization",
      value: `Bearer ${token}`,
      enabled: true,
    })
  }

  const cookies = await resolveCookies(ctx, activeJar, workspace.id)

  return {
    fullUrl,
    headers,
    body,
    resolutionEvents: log.events,
    cookies,
    headerOrigins,
    resolvedAuth: auth,
    dynamicAuthOverride: applied.resolvedAuth,
    inheritedAuthFolderId: inheritedFromFolderId,
    inheritedAuthFolderName: inheritedFromFolderName,
    inheritedAuthFromWorkspace: inheritedFromWorkspace,
  }
}
