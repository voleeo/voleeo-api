import type { RequestParameter } from "../../../../packages/types/bindings"
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
