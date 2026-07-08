import type { RequestBody } from "@/store/requests"
import type { RequestParameter } from "../../../../../../packages/types/bindings"
import { encodeQueryValue, queryParamsOnly } from "../../paramUtils"
import type { AnnotatedHeader, ResolveSendInput } from "../types"
import { type ResolveCtx, resolve } from "./context"

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
