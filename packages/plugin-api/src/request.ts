// Shared request-serialization helpers for "copy as <tool>" plugins (cURL,
// HTTPie, fetch). Each generator resolves the same stored `HttpRequest` — render
// templates, split path-params from query, read auth state — then formats its
// own output, so only these model-level helpers are shared.

import type { AuthConfig, RequestParameter } from "@voleeo/types/bindings"
import type { Context } from "./context"

/** POSIX-safe single-quote (bash/zsh). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** `:param` names in a URL's path (query/fragment ignored). */
export function extractPathParamNames(url: string): string[] {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split("?")[0].split("#")[0]
  }
  return [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1])
}

/** Replace `:param` segments with their (URL-encoded) values; disabled/missing → "". */
export function substitutePathParams(
  url: string,
  pathParams: Map<string, { value: string; enabled: boolean }>,
): string {
  return url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_full, name: string) => {
    const param = pathParams.get(name)
    if (!param || !param.enabled) return ""
    return encodeURIComponent(param.value)
  })
}

export function appendQuery(url: string, qs: string): string {
  if (!qs) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}${qs}`
}

export async function resolveStr(ctx: Context, value: string): Promise<string> {
  return ctx.templates.render(value)
}

export async function resolveParams(
  ctx: Context,
  params: RequestParameter[],
): Promise<Array<{ name: string; value: string; enabled: boolean }>> {
  // Disabled rows skip template resolution entirely — matches Send behavior
  // and avoids firing side-effecting templates (ask(), prompts) for rows the
  // user has deliberately turned off.
  return Promise.all(
    params.map(async (p) =>
      p.enabled
        ? {
            name: await resolveStr(ctx, p.name),
            value: await resolveStr(ctx, p.value),
            enabled: true,
          }
        : { name: p.name, value: p.value, enabled: false },
    ),
  )
}

export function authDisabled(auth: AuthConfig | undefined): boolean {
  return !!auth && "enabled" in auth && auth.enabled === false
}

/** Dynamic schemes the host signs over the final request (SigV4, OAuth 1.0). */
export function isSignedScheme(auth: AuthConfig | undefined): boolean {
  return (
    !!auth &&
    (auth.kind === "aws_sig_v4" || auth.kind === "oauth1") &&
    !authDisabled(auth)
  )
}
