import type { GitChange } from "../../../packages/types/bindings"

export const C_GET = "var(--base0C)"
export const C_POST = "var(--base0B)"
export const C_PUT = "var(--base0A)"
export const C_DELETE = "var(--base08)"
export const C_PATCH = "var(--base0E)"
export const C_META = "var(--base0D)"
export const C_WS = "var(--base09)"
// Deliberately shares base0E with C_PATCH and the bidi kind in
// GrpcWorkspace/GrpcPane/methodKind.ts — purple is the gRPC accent.
export const C_GRPC = "var(--base0E)"
// Tree badge for requests with a GraphQL body. base0F is the only palette slot
// no other badge uses — the nearest base16 fit for GraphQL's pink brand.
export const C_GQL = "var(--base0F)"

export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
    case "QUERY":
      return C_GET
    case "POST":
      return C_POST
    case "PUT":
      return C_PUT
    case "DELETE":
      return C_DELETE
    case "PATCH":
      return C_PATCH
    case "HEAD":
    case "OPTIONS":
    case "TRACE":
    case "CONNECT":
      return C_META
    default:
      return "var(--base04)"
  }
}

/** Base16 color for a git change badge — shared by the tree and Source Control. */
export function gitChangeColor(change: GitChange): string {
  switch (change) {
    case "added":
    case "untracked":
      return "var(--base0B)"
    case "modified":
    case "renamed":
      return "var(--base0D)"
    case "deleted":
      return "var(--base09)"
    case "conflicted":
      return "var(--base08)"
  }
}

/** Tailwind bg-class for a response-status dot — same three tiers the history
 * picker uses for its status numbers (2xx green, 3xx/4xx amber, 5xx+ red). */
export function statusDotClass(status: number): string {
  if (status < 300) return "bg-success"
  if (status < 500) return "bg-amber-500"
  return "bg-destructive"
}

/** Single-letter badge for a git change (M/A/D/R/U/!). */
export function gitChangeLabel(change: GitChange): string {
  switch (change) {
    case "added":
      return "A"
    case "untracked":
      return "U"
    case "modified":
      return "M"
    case "renamed":
      return "R"
    case "deleted":
      return "D"
    case "conflicted":
      return "!"
  }
}
