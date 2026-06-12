import { type ResolutionLog, resolveTemplate } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { CookieJar } from "@/store/cookies"
import type { EnvironmentVariable } from "@/store/environment"
import type { AuthConfig, RequestBody } from "@/store/requests"
import {
  commands,
  type RequestParameter,
  type StoredCookie_Deserialize,
} from "../../../../../packages/types/bindings"
import { encodeQueryValue, queryParamsOnly } from "../paramUtils"
import type { AnnotatedHeader, ResolveSendInput } from "./types"

/** Shared resolution context — `log.events` accumulates across every step. */
export interface ResolveCtx {
  vars: EnvironmentVariable[]
  fns: BoundTemplateFunction[]
  log: ResolutionLog
}

// Spread shares `log.events`, so events land in the one accumulating array.
const resolve = (ctx: ResolveCtx, value: string, label: string) =>
  resolveTemplate(value, ctx.vars, ctx.fns, { ...ctx.log, label })

/** Path-param substitution, base-URL templating, then the query string. */
export async function resolveUrl(
  ctx: ResolveCtx,
  input: ResolveSendInput,
): Promise<string> {
  const { urlDraft, pathParamValues, pathParamEnabled, request } = input

  // Disabled/empty path params resolve to "" so `:name` is never sent literally.
  let withParams = urlDraft
  for (const [name, value] of Object.entries(pathParamValues)) {
    const on = pathParamEnabled[name] !== false
    const v = on && value ? await resolve(ctx, value, `URL path :${name}`) : ""
    withParams = withParams.replace(
      new RegExp(`:${name}(?=[/?#]|$)`),
      encodeURIComponent(v),
    )
  }
  const base = await resolve(ctx, withParams, "URL")

  // Path params live in `parameters` too — exclude them so they don't double up.
  const params = queryParamsOnly(request.parameters ?? [], urlDraft).filter(
    (p) => p.enabled && p.name.trim() !== "",
  )
  const parts: string[] = []
  for (const p of params) {
    const v = await resolve(ctx, p.value, `Query param "${p.name}"`)
    parts.push(
      v
        ? `${encodeURIComponent(p.name)}=${encodeQueryValue(v)}`
        : encodeURIComponent(p.name),
    )
  }
  return base + (parts.length ? `?${parts.join("&")}` : "")
}

export function resolveHeaders(
  ctx: ResolveCtx,
  annotated: AnnotatedHeader[],
): Promise<RequestParameter[]> {
  return Promise.all(
    annotated.map(async ({ row: h }) => ({
      ...h,
      name: await resolve(ctx, h.name, `Header name "${h.name}"`),
      value: await resolve(ctx, h.value, `Header "${h.name}"`),
    })),
  )
}

/** Templates raw text and form/multipart field values; file paths pass through. */
export async function resolveBody(
  ctx: ResolveCtx,
  stored: RequestBody | null | undefined,
): Promise<RequestBody | null> {
  if (!stored || stored.kind === "none") return null

  if (stored.kind === "form_url_encoded" || stored.kind === "multipart") {
    const fields = await Promise.all(
      (stored.fields ?? []).map(async (f) => ({
        ...f,
        name: await resolve(ctx, f.name, `Body field "${f.name}"`),
        value: f.isFile
          ? f.value
          : await resolve(ctx, f.value, `Body field "${f.name}"`),
      })),
    )
    return { kind: stored.kind, text: "", fields }
  }
  if (stored.kind === "binary") {
    return {
      kind: "binary",
      text: "",
      filePath: stored.filePath,
      contentType: stored.contentType,
    }
  }
  if (stored.kind === "graphql") {
    const query = await resolve(ctx, stored.text ?? "", "GraphQL query")
    if (!query.trim()) return null
    const variables = stored.graphqlVariables
      ? await resolve(ctx, stored.graphqlVariables, "GraphQL variables")
      : undefined
    return { kind: "graphql", text: query, graphqlVariables: variables }
  }
  if (!(stored.text ?? "").trim()) return null
  return {
    kind: stored.kind,
    text: await resolve(ctx, stored.text ?? "", "Body"),
  }
}

/** Auth → a header, or (api_key in query) a `key=value` to append to the URL. */
export async function applyAuth(
  ctx: ResolveCtx,
  auth: AuthConfig,
): Promise<{ headers: RequestParameter[]; query?: string }> {
  if (auth.kind === "bearer") {
    const token = await resolve(ctx, auth.token, "Auth: Bearer token")
    return { headers: [authHeader("Authorization", `Bearer ${token}`)] }
  }
  if (auth.kind === "basic") {
    const user = await resolve(ctx, auth.username, "Auth: Basic username")
    const pass = await resolve(ctx, auth.password, "Auth: Basic password")
    const enc = utf8Base64(`${user}:${pass}`)
    return { headers: [authHeader("Authorization", `Basic ${enc}`)] }
  }
  if (auth.kind === "api_key") {
    const key = await resolve(ctx, auth.key, "Auth: API key name")
    const value = await resolve(ctx, auth.value, "Auth: API key value")
    if (!key.trim()) return { headers: [] }
    return auth.location === "query"
      ? {
          headers: [],
          query: `${encodeURIComponent(key)}=${encodeQueryValue(value)}`,
        }
      : { headers: [authHeader(key, value)] }
  }
  return { headers: [] }
}

export async function resolveCookies(
  ctx: ResolveCtx,
  activeJar: CookieJar | null | undefined,
  workspaceId: string,
): Promise<StoredCookie_Deserialize[] | null> {
  if (!activeJar) return null

  // The encrypt plugin keeps `enc:v1:` ciphertext through resolution; decrypt it
  // here so the Timing tab and the wire show the actual plaintext.
  const resolveAndDecrypt = async (raw: string, label: string) => {
    const before = ctx.log.events.length
    const resolved = await resolve(ctx, raw, label)
    const plain = await decryptInline(resolved, workspaceId)
    if (plain !== resolved) {
      for (let i = before; i < ctx.log.events.length; i++) {
        const ev = ctx.log.events[i]
        if (ev.result.includes("enc:v1:")) {
          ev.result = await decryptInline(ev.result, workspaceId)
        }
      }
    }
    return plain
  }
  return Promise.all(
    activeJar.cookies.map(async (c) => ({
      ...c,
      value: await resolveAndDecrypt(c.value, `Cookie "${c.name}" value`),
      domain: await resolveAndDecrypt(c.domain, `Cookie "${c.name}" domain`),
      path: await resolveAndDecrypt(c.path, `Cookie "${c.name}" path`),
    })),
  )
}

function authHeader(name: string, value: string): RequestParameter {
  return { id: "__auth", name, value, enabled: true }
}

/** Replace each `enc:v1:<hex>` with its plaintext; on failure leave it in place
 *  (visible breakage beats a silent empty). */
async function decryptInline(
  text: string,
  workspaceId: string,
): Promise<string> {
  if (!text.includes("enc:v1:")) return text
  const re = /enc:v1:[0-9A-Fa-f]+/g
  const blobs = Array.from(new Set(text.match(re) ?? []))
  if (blobs.length === 0) return text
  const map = new Map<string, string>()
  for (const blob of blobs) {
    const res = await commands.workspaceDecryptValue(workspaceId, blob)
    map.set(blob, res.status === "ok" ? res.data : blob)
  }
  return text.replace(re, (m) => map.get(m) ?? m)
}

/** `btoa` throws on non-Latin1 input (e.g. non-ASCII creds); encode UTF-8 first. */
function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
