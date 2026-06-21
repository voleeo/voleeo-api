import { MANAGED_CONTENT_TYPE } from "@/lib/contentTypes"
import { randomId } from "@/lib/ids"
import type {
  BodyField,
  BodyKind,
  RequestBody,
  RequestParameter,
} from "@/store/requests"

const MANAGED_VALUES = new Set(Object.values(MANAGED_CONTENT_TYPE))

/** Mutable working copy of a request body while the editor is open. */
export interface BodyWorking {
  kind: BodyKind
  text: string
  fields: BodyField[]
  filePath: string | null
  contentType: string | null
  graphqlVariables: string
}

export function workingFromBody(
  b: RequestBody | null | undefined,
): BodyWorking {
  return {
    kind: b?.kind ?? "none",
    text: b?.text ?? "",
    fields: b?.fields ?? [],
    filePath: b?.filePath ?? null,
    contentType: b?.contentType ?? null,
    graphqlVariables: b?.graphqlVariables ?? "",
  }
}

/** Build the persisted RequestBody from the working state. */
export function composeBody(w: BodyWorking): RequestBody | null {
  switch (w.kind) {
    case "none":
      return null
    case "form_url_encoded":
    case "multipart":
      return { kind: w.kind, text: "", fields: w.fields }
    case "binary":
      return {
        kind: w.kind,
        text: "",
        filePath: w.filePath ?? undefined,
        contentType: w.contentType ?? undefined,
      }
    case "graphql":
      return {
        kind: w.kind,
        text: w.text,
        graphqlVariables: w.graphqlVariables || undefined,
      }
    default:
      return { kind: w.kind, text: w.text }
  }
}

/** Content signature — tells our own debounced saves apart from external
 *  mutations (e.g. variable-rename propagation) echoing back through the store. */
export function bodySig(b: RequestBody | null | undefined): string {
  if (!b) return ""
  return JSON.stringify([
    b.kind,
    b.text ?? "",
    b.fields?.map((f) => [f.value, f.isFile]) ?? null,
    b.filePath ?? null,
    b.contentType ?? null,
    b.graphqlVariables ?? "",
  ])
}

/** Reconcile the auto-managed Content-Type header for a body kind. */
export function reconcileContentTypeHeader(
  headers: RequestParameter[],
  kind: BodyKind,
): RequestParameter[] {
  const ct = MANAGED_CONTENT_TYPE[kind]
  const idx = headers.findIndex((h) => h.name.toLowerCase() === "content-type")
  if (ct) {
    return idx === -1
      ? [
          ...headers,
          { id: randomId(), name: "Content-Type", value: ct, enabled: true },
        ]
      : headers.map((h, i) => (i === idx ? { ...h, value: ct } : h))
  }
  // Drop only headers whose value we previously auto-injected.
  return headers.filter(
    (h) =>
      !(h.name.toLowerCase() === "content-type" && MANAGED_VALUES.has(h.value)),
  )
}
