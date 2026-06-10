import type {
  AuthConfig,
  EnvironmentVariable,
  RequestBody,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { blob, type Field, listField } from "../engine"
import {
  authCompare,
  authEntries,
  authSummary,
  paramEqual,
  paramId,
  paramValue,
} from "../helpers"

const BODY_KIND_LABEL: Record<RequestBody["kind"], string> = {
  none: "No body",
  json: "JSON",
  xml: "XML",
  html: "HTML",
  text: "Text",
  form_url_encoded: "Form URL Encoded",
  multipart: "Multipart Form",
  binary: "Binary",
}

function serializeBody(b?: RequestBody | null): string {
  if (!b || b.kind === "none") return ""
  switch (b.kind) {
    case "form_url_encoded":
    case "multipart":
      return (b.fields ?? [])
        .map(
          (f) =>
            `${f.enabled ? "" : "#"}${f.name}=${f.isFile ? `@${f.value}` : f.value}`,
        )
        .join("\n")
    case "binary":
      return `${b.filePath ?? ""} ${b.contentType ?? ""}`.trim()
    default:
      return b.text ?? ""
  }
}

export const bodyText = (b?: RequestBody | null) =>
  b && b.kind !== "none" ? `${b.kind}\n${serializeBody(b)}` : ""

// Lead with the body type so the diff doesn't read as anonymous text.
export const bodyShow = (b?: RequestBody | null) => {
  if (!b || b.kind === "none") return "(empty)"
  const body = serializeBody(b)
  const label = BODY_KIND_LABEL[b.kind]
  return body ? `${label}\n${body}` : label
}

const NONE_AUTH: AuthConfig = { kind: "none" }

export function authBlob<E extends { auth?: AuthConfig }>(): Field<E> {
  return blob<E>(
    "auth",
    "Authentication",
    (e) => authCompare(e.auth ?? NONE_AUTH),
    (e) => authSummary(e.auth ?? NONE_AUTH),
    (from, to) => {
      to.auth = from.auth
    },
    {
      // Review shows each auth part on its own row; conflicts stay atomic.
      entries: (e) =>
        authEntries(e.auth ?? NONE_AUTH).map((x) => ({
          label: x.label,
          value: x.value,
          secret: x.secret,
        })),
    },
  )
}

export function varList<
  E extends { variables?: EnvironmentVariable[] },
>(): Field<E> {
  return listField<E, EnvironmentVariable>({
    id: "var",
    group: "Variables",
    get: (e) => e.variables ?? [],
    set: (e, items) => {
      e.variables = items
    },
    idOf: (v) => v.key,
    equal: (a, b) =>
      a.value === b.value &&
      a.encrypted === b.encrypted &&
      a.enabled === b.enabled,
    labelOf: (v) => v.key,
    valueOf: (v) => (v.enabled === false ? `${v.value} (disabled)` : v.value),
    secretOf: (v) => v.encrypted,
  })
}

export function headerList<
  E extends { headers?: RequestParameter[] },
>(): Field<E> {
  return listField<E, RequestParameter>({
    id: "header",
    group: "Headers",
    get: (e) => e.headers ?? [],
    set: (e, items) => {
      e.headers = items
    },
    idOf: paramId,
    equal: paramEqual,
    labelOf: (p) => p.name,
    valueOf: paramValue,
  })
}
