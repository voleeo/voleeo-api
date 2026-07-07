import type { AuthConfig } from "../../../../packages/types/bindings"
import type { AuthEntry } from "./authEntries"

export const AUTH_TYPE_LABEL: Record<string, string> = {
  none: "None",
  inherit: "Inherited",
  bearer: "Bearer token",
  basic: "Basic",
  api_key: "API key",
  aws_sig_v4: "AWS SigV4",
  oauth1: "OAuth 1.0",
  oauth2: "OAuth 2.0",
  digest: "Digest",
  ntlm: "NTLM",
}

export function stateEntry(enabled: boolean | undefined): AuthEntry {
  return {
    key: "auth.enabled",
    label: "State",
    value: enabled === false ? "Disabled" : "Enabled",
  }
}

/** Entries for the simple, single-shape auth kinds. */
export function simpleAuthEntries(
  auth: Extract<
    AuthConfig,
    { kind: "none" | "inherit" | "bearer" | "basic" | "api_key" | "digest" }
  >,
  type: AuthEntry,
): AuthEntry[] | null {
  switch (auth.kind) {
    case "none":
      return []
    case "inherit":
      return [
        type,
        {
          key: "auth.from",
          label: "Inherit from",
          value: auth.from ?? "folder",
        },
      ]
    case "bearer":
      return [
        type,
        { key: "auth.token", label: "Token", value: auth.token, secret: true },
        stateEntry(auth.enabled),
      ]
    case "basic":
      return [
        type,
        { key: "auth.username", label: "Username", value: auth.username },
        {
          key: "auth.password",
          label: "Password",
          value: auth.password,
          secret: true,
        },
        stateEntry(auth.enabled),
      ]
    case "api_key":
      return [
        type,
        { key: "auth.key", label: "Key name", value: auth.key },
        { key: "auth.value", label: "Value", value: auth.value, secret: true },
        { key: "auth.location", label: "Sent in", value: auth.location },
        stateEntry(auth.enabled),
      ]
    case "digest":
      return [
        type,
        { key: "auth.username", label: "Username", value: auth.username },
        {
          key: "auth.password",
          label: "Password",
          value: auth.password ?? "",
          secret: true,
        },
        stateEntry(auth.enabled),
      ]
    default:
      return null
  }
}

export function ntlmEntries(
  auth: Extract<AuthConfig, { kind: "ntlm" }>,
  type: AuthEntry,
): AuthEntry[] {
  const entries: AuthEntry[] = [
    type,
    { key: "auth.username", label: "Username", value: auth.username },
    {
      key: "auth.password",
      label: "Password",
      value: auth.password ?? "",
      secret: true,
    },
  ]
  if (auth.domain)
    entries.push({ key: "auth.domain", label: "Domain", value: auth.domain })
  if (auth.workstation)
    entries.push({
      key: "auth.workstation",
      label: "Workstation",
      value: auth.workstation,
    })
  entries.push(stateEntry(auth.enabled))
  return entries
}

export function awsSigV4Entries(
  auth: Extract<AuthConfig, { kind: "aws_sig_v4" }>,
  type: AuthEntry,
): AuthEntry[] {
  const entries: AuthEntry[] = [
    type,
    {
      key: "auth.access_key",
      label: "Access key ID",
      value: auth.access_key,
    },
    {
      key: "auth.secret_key",
      label: "Secret access key",
      value: auth.secret_key,
      secret: true,
    },
  ]
  if (auth.session_token) {
    entries.push({
      key: "auth.session_token",
      label: "Session token",
      value: auth.session_token,
      secret: true,
    })
  }
  entries.push(
    { key: "auth.region", label: "Region", value: auth.region },
    { key: "auth.service", label: "Service", value: auth.service },
    stateEntry(auth.enabled),
  )
  return entries
}
