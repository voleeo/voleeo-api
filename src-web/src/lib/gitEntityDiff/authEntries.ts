import type { AuthConfig } from "../../../../packages/types/bindings"
import {
  AUTH_TYPE_LABEL,
  awsSigV4Entries,
  ntlmEntries,
  simpleAuthEntries,
} from "./authEntryBuilders"
import { oauth1Entries, oauth2Entries } from "./authOAuthEntries"

/** A scalar auth field, flattened so auth can be diffed like any other value. */
export interface AuthEntry {
  /** Stable key used as the conflict-field id (e.g. `auth.token`). */
  key: string
  label: string
  value: string
  secret?: boolean
}

/** Stable string for equality checks (auth is merged atomically in conflicts). */
export function authCompare(auth: AuthConfig): string {
  return JSON.stringify(authEntries(auth).map((e) => [e.key, e.value]))
}

/** One-line human summary of an auth config, secrets masked. */
export function authSummary(auth: AuthConfig): string {
  const entries = authEntries(auth)
  if (!entries.length) return "No auth"
  return entries
    .map((e) => (e.secret ? `${e.label} ••••` : `${e.label}: ${e.value}`))
    .join(" · ")
}

/** Whether an auth config carries a secret (for masking the chooser value). */
export function authHasSecret(auth: AuthConfig): boolean {
  return authEntries(auth).some((e) => e.secret)
}

/** Flatten an AuthConfig into comparable entries; empty for `none`. */
export function authEntries(auth: AuthConfig): AuthEntry[] {
  const type: AuthEntry = {
    key: "auth.type",
    label: "Type",
    value: AUTH_TYPE_LABEL[auth.kind] ?? auth.kind,
  }
  switch (auth.kind) {
    case "none":
    case "inherit":
    case "bearer":
    case "basic":
    case "api_key":
    case "digest":
      // biome-ignore lint/style/noNonNullAssertion: exhaustive over the cases above
      return simpleAuthEntries(auth, type)!
    case "aws_sig_v4":
      return awsSigV4Entries(auth, type)
    case "oauth1":
      return oauth1Entries(auth, type)
    case "oauth2":
      return oauth2Entries(auth, type)
    case "ntlm":
      return ntlmEntries(auth, type)
    default:
      return [type]
  }
}
