import type { RequestBody } from "../../../packages/types/bindings"

type BodyKind = RequestBody["kind"]

export const MANAGED_CONTENT_TYPE: Partial<Record<BodyKind, string>> = {
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  form_url_encoded: "application/x-www-form-urlencoded",
  graphql: "application/json",
}
