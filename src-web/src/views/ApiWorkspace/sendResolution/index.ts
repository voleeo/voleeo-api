import { isAuthEnabled } from "@/lib/authSchemes"
import type { ResolutionLog } from "@/lib/template"
import { oauth2EnsureToken, resolveOAuth2Templates } from "@/store/oauth2"
import type { AuthConfig, RequestParameter } from "@/store/requests"
import {
  mergeInheritedHeadersAnnotated,
  mergeInheritedVariables,
  resolveInheritedAuthAnnotated,
} from "./inheritance"
import {
  applyAuth,
  type ResolveCtx,
  resolveBody,
  resolveCookies,
  resolveHeaders,
  resolveUrl,
} from "./steps"
import type { ResolvedSendPayload, ResolveSendInput } from "./types"

export async function applyAuthForSend(
  ctx: ResolveCtx,
  auth: AuthConfig,
  workspaceId: string,
  forSend: boolean,
): Promise<{
  headers: RequestParameter[]
  query: string | null
  dynamicAuthOverride?: AuthConfig
}> {
  const applied = await applyAuth(ctx, auth)
  const headers = [...applied.headers]
  if (forSend && auth.kind === "oauth2" && isAuthEnabled(auth)) {
    const resolved = await resolveOAuth2Templates(auth, ctx.vars, ctx.fns)
    const token = await oauth2EnsureToken(workspaceId, resolved)
    headers.push({
      id: "__auth",
      name: "Authorization",
      value: `Bearer ${token}`,
      enabled: true,
    })
  }
  return {
    headers,
    query: applied.query ?? null,
    dynamicAuthOverride: applied.resolvedAuth,
  }
}

export {
  mergeEnvVars,
  mergeInheritedHeadersAnnotated,
  mergeInheritedVariables,
  resolveInheritedAuth,
  resolveInheritedAuthAnnotated,
} from "./inheritance"
export { buildSentSnapshot } from "./snapshot"
export { resolveBody } from "./steps"
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
  const appliedAuth = await applyAuthForSend(
    ctx,
    auth,
    workspace.id,
    !!input.forSend,
  )
  headers.push(...appliedAuth.headers)
  if (appliedAuth.query)
    fullUrl += (fullUrl.includes("?") ? "&" : "?") + appliedAuth.query

  const cookies = await resolveCookies(ctx, activeJar, workspace.id)

  return {
    fullUrl,
    headers,
    body,
    resolutionEvents: log.events,
    cookies,
    headerOrigins,
    resolvedAuth: auth,
    dynamicAuthOverride: appliedAuth.dynamicAuthOverride,
    inheritedAuthFolderId: inheritedFromFolderId,
    inheritedAuthFolderName: inheritedFromFolderName,
    inheritedAuthFromWorkspace: inheritedFromWorkspace,
  }
}
