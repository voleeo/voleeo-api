import type { HttpResponse } from "../../../../../packages/types/bindings"

export type BodyLang = "json" | "xml" | "plain"

/** Content-Type header value, lowercased, or null when absent. */
export function responseContentType(
  response: HttpResponse | null,
): string | null {
  if (!response) return null
  const h = response.headers.find(
    (x) => x.name.toLowerCase() === "content-type",
  )
  return h?.value.toLowerCase() ?? null
}

/** True when the response is text/html — eligible for the rendered preview. */
export function isHtmlResponse(response: HttpResponse | null): boolean {
  if (!response?.bodyIsText) return false
  return responseContentType(response)?.includes("text/html") ?? false
}

/** True when the response is an SSE stream — rendered as live frames. */
export function isSseResponse(response: HttpResponse | null): boolean {
  return responseContentType(response)?.includes("text/event-stream") ?? false
}
