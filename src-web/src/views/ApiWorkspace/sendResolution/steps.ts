// Resolution steps grouped by concern: URL/headers/body, auth, cookies.
// Split from a single file — re-exported here so `./steps` stays a stable import path for `index.ts`.

export { applyAuth } from "./steps/auth"
export type { ResolveCtx } from "./steps/context"
export { resolveCookies } from "./steps/cookies"
export { resolveBody, resolveHeaders, resolveUrl } from "./steps/request"
