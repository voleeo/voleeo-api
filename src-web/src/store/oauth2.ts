import { errorMessage } from "@/lib/error"
import { resolveTemplate } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { EnvironmentVariable } from "@/store/environment"
import {
  type AuthConfig,
  commands,
  type Oauth2TokenDetails,
  type Oauth2TokenStatus,
} from "../../../packages/types/bindings"

/** OAuth2 config fields that support `{{ }}` templates and must be concrete
 *  before any token request — the endpoints need real values and the cache key
 *  is derived from token_url/client_id/scope/audience. */
const OAUTH2_TEMPLATE_FIELDS = [
  "token_url",
  "auth_url",
  "client_id",
  "client_secret",
  "scope",
  "audience",
  "username",
  "password",
  "code_verifier",
] as const

/** Expand `{{ }}` in an OAuth2 auth config's string fields. No-op for other
 *  kinds. Run before every oauth2 command so endpoints and cache keys match. */
export async function resolveOAuth2Templates(
  auth: AuthConfig,
  vars: EnvironmentVariable[],
  fns: BoundTemplateFunction[],
): Promise<AuthConfig> {
  if (auth.kind !== "oauth2") return auth
  const out = { ...auth }
  for (const field of OAUTH2_TEMPLATE_FIELDS) {
    const value = out[field]
    if (typeof value === "string" && value.includes("{{")) {
      out[field] = await resolveTemplate(value, vars, fns)
    }
  }
  return out
}

/** Thin wrappers over the OAuth 2.0 token commands. The token lives in a
 *  machine-local backend cache; these acquire/inspect it. Sole home for the
 *  `commands.oauth2*` invokes. */

export type { Oauth2TokenDetails, Oauth2TokenStatus }

export async function oauth2Status(
  workspaceId: string,
  auth: AuthConfig,
): Promise<Oauth2TokenStatus> {
  const res = await commands.oauth2TokenStatus(workspaceId, auth)
  if (res.status === "error") throw new Error(errorMessage(res.error))
  return res.data
}

/** The cached token's full fields (raw access token included), for the expandable
 *  token inspector. `null` when nothing is cached. */
export async function oauth2TokenDetails(
  workspaceId: string,
  auth: AuthConfig,
): Promise<Oauth2TokenDetails | null> {
  const res = await commands.oauth2TokenDetails(workspaceId, auth)
  if (res.status === "error") throw new Error(errorMessage(res.error))
  return res.data
}

export async function oauth2FetchToken(
  workspaceId: string,
  auth: AuthConfig,
): Promise<Oauth2TokenStatus> {
  const res = await commands.oauth2FetchToken(workspaceId, auth)
  if (res.status === "error") throw new Error(errorMessage(res.error))
  return res.data
}

export async function oauth2ClearToken(
  workspaceId: string,
  auth: AuthConfig,
): Promise<void> {
  const res = await commands.oauth2ClearToken(workspaceId, auth)
  if (res.status === "error") throw new Error(errorMessage(res.error))
}

export async function oauth2EnsureToken(
  workspaceId: string,
  auth: AuthConfig,
): Promise<string> {
  const res = await commands.oauth2EnsureToken(workspaceId, auth)
  if (res.status === "ok") return res.data
  if (
    auth.kind === "oauth2" &&
    (auth.grant_type === "authorization_code" || auth.grant_type === "implicit")
  ) {
    await oauth2FetchToken(workspaceId, auth) // opens browser, caches the token
    const retry = await commands.oauth2EnsureToken(workspaceId, auth)
    if (retry.status === "ok") return retry.data
    throw new Error(errorMessage(retry.error))
  }
  throw new Error(errorMessage(res.error))
}
