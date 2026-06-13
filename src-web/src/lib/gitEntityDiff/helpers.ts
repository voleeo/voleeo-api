import type {
  AuthConfig,
  RequestParameter,
} from "../../../../packages/types/bindings"
import type { FieldChange, FieldGroup } from "./types"

/** A scalar field change, or null when before == after. */
export function scalarField(
  group: FieldGroup,
  before: string | undefined,
  after: string | undefined,
  opts: { label?: string; secret?: boolean } = {},
): FieldChange | null {
  const b = before ?? ""
  const a = after ?? ""
  if (b === a) return null
  if (!b) return { group, kind: "added", after: a, ...opts }
  if (!a) return { group, kind: "removed", before: b, ...opts }
  return { group, kind: "changed", before: b, after: a, ...opts }
}

/** Turn a keyed list diff into per-item field changes. `keyPrefix` makes each
 * change individually discardable (`prefix:itemId`). */
export function listToFields<T>(
  group: FieldGroup,
  diff: ListDiff<T>,
  labelOf: (t: T) => string,
  getValue: (t: T) => string,
  secretOf: (t: T) => boolean = () => false,
  keyPrefix = "",
): FieldChange[] {
  const out: FieldChange[] = []
  const k = (id: string) => `${keyPrefix}:${id}`
  for (const { id, item } of diff.added)
    out.push({
      group,
      label: labelOf(item),
      kind: "added",
      after: getValue(item),
      secret: secretOf(item),
      key: k(id),
    })
  for (const { id, item } of diff.removed)
    out.push({
      group,
      label: labelOf(item),
      kind: "removed",
      before: getValue(item),
      secret: secretOf(item),
      key: k(id),
    })
  for (const { id, before, after } of diff.changed)
    out.push({
      group,
      label: labelOf(after),
      kind: "changed",
      before: getValue(before),
      after: getValue(after),
      secret: secretOf(after),
      key: k(id),
    })
  return out
}

/** Diff two keyed lists (params/headers/variables) by a stable identity. */
export interface ListDiff<T> {
  added: { id: string; item: T }[]
  removed: { id: string; item: T }[]
  changed: { id: string; before: T; after: T }[]
}

export function diffList<T>(
  oldList: T[],
  newList: T[],
  idOf: (t: T) => string,
  equal: (a: T, b: T) => boolean,
): ListDiff<T> {
  const oldBy = new Map(oldList.map((t) => [idOf(t), t]))
  const newBy = new Map(newList.map((t) => [idOf(t), t]))
  const out: ListDiff<T> = { added: [], removed: [], changed: [] }
  for (const [id, item] of newBy) {
    const prev = oldBy.get(id)
    if (!prev) out.added.push({ id, item })
    else if (!equal(prev, item))
      out.changed.push({ id, before: prev, after: item })
  }
  for (const [id, item] of oldBy) {
    if (!newBy.has(id)) out.removed.push({ id, item })
  }
  return out
}

export const paramId = (p: RequestParameter) => p.name
export const paramEqual = (a: RequestParameter, b: RequestParameter) =>
  a.value === b.value && a.enabled === b.enabled
export const paramValue = (p: RequestParameter) =>
  p.enabled ? p.value : `${p.value} (disabled)`

/** A scalar auth field, flattened so auth can be diffed like any other value. */
export interface AuthEntry {
  /** Stable key used as the conflict-field id (e.g. `auth.token`). */
  key: string
  label: string
  value: string
  secret?: boolean
}

const AUTH_TYPE_LABEL: Record<string, string> = {
  none: "None",
  inherit: "Inherited",
  bearer: "Bearer token",
  basic: "Basic",
  api_key: "API key",
  aws_sig_v4: "AWS SigV4",
}

function stateEntry(enabled: boolean | undefined): AuthEntry {
  return {
    key: "auth.enabled",
    label: "State",
    value: enabled === false ? "Disabled" : "Enabled",
  }
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
    case "aws_sig_v4": {
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
    default:
      return [type]
  }
}
