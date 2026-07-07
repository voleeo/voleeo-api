import type { AuthConfig } from "../../../../packages/types/bindings"
import type { AuthEntry } from "./authEntries"
import { stateEntry } from "./authEntryBuilders"

const OAUTH1_SIGNATURE_LABEL: Record<string, string> = {
  hmac_sha1: "HMAC-SHA1",
  hmac_sha256: "HMAC-SHA256",
  hmac_sha512: "HMAC-SHA512",
  rsa_sha1: "RSA-SHA1",
  rsa_sha256: "RSA-SHA256",
  rsa_sha512: "RSA-SHA512",
  plain_text: "PLAINTEXT",
}

export function oauth1Entries(
  auth: Extract<AuthConfig, { kind: "oauth1" }>,
  type: AuthEntry,
): AuthEntry[] {
  const entries: AuthEntry[] = [
    type,
    {
      key: "auth.consumer_key",
      label: "Consumer key",
      value: auth.consumer_key,
    },
    {
      key: "auth.consumer_secret",
      label: "Consumer secret",
      value: auth.consumer_secret,
      secret: true,
    },
  ]
  if (auth.token) {
    entries.push({ key: "auth.token", label: "Token", value: auth.token })
  }
  if (auth.token_secret) {
    entries.push({
      key: "auth.token_secret",
      label: "Token secret",
      value: auth.token_secret,
      secret: true,
    })
  }
  entries.push({
    key: "auth.signature_method",
    label: "Signature",
    value:
      OAUTH1_SIGNATURE_LABEL[auth.signature_method ?? "hmac_sha1"] ??
      auth.signature_method ??
      "hmac_sha1",
  })
  if (auth.private_key) {
    entries.push({
      key: "auth.private_key",
      label: "Private key",
      value: auth.private_key,
      secret: true,
    })
  }
  entries.push({
    key: "auth.params_location",
    label: "Add params to",
    value: (auth.params_location ?? "header") === "query" ? "Query" : "Header",
  })
  for (const [key, label] of [
    ["callback", "Callback URL"],
    ["verifier", "Verifier"],
    ["timestamp", "Timestamp"],
    ["nonce", "Nonce"],
    ["version", "Version"],
    ["realm", "Realm"],
  ] as const) {
    const value = auth[key]
    if (value) entries.push({ key: `auth.${key}`, label, value })
  }
  entries.push(stateEntry(auth.enabled))
  return entries
}

export function oauth2Entries(
  auth: Extract<AuthConfig, { kind: "oauth2" }>,
  type: AuthEntry,
): AuthEntry[] {
  const entries: AuthEntry[] = [
    type,
    { key: "auth.grant_type", label: "Grant", value: auth.grant_type },
    {
      key: "auth.token_url",
      label: "Token URL",
      value: auth.token_url,
    },
    { key: "auth.client_id", label: "Client ID", value: auth.client_id },
  ]
  if (auth.client_secret) {
    entries.push({
      key: "auth.client_secret",
      label: "Client secret",
      value: auth.client_secret,
      secret: true,
    })
  }
  if (auth.auth_url) {
    entries.push({
      key: "auth.auth_url",
      label: "Authorization URL",
      value: auth.auth_url,
    })
  }
  if (auth.scope) {
    entries.push({ key: "auth.scope", label: "Scope", value: auth.scope })
  }
  if (auth.audience) {
    entries.push({
      key: "auth.audience",
      label: "Audience",
      value: auth.audience,
    })
  }
  if (auth.use_external_browser) {
    entries.push({
      key: "auth.use_external_browser",
      label: "Use external browser",
      value: "Enabled",
    })
  }
  entries.push(stateEntry(auth.enabled))
  return entries
}
