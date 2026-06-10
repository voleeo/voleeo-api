// Merge + revert operations over the declarative field specs. Read-side
// derivations (review detail, conflict chooser) live in engine.ts.

import type { Field } from "./engine"
import { merge3List, merge3Scalar } from "./merge3"
import type { Choice } from "./types"

export function mergeEntity<E>(
  specs: Field<E>[],
  base: E | null,
  ours: E,
  theirs: E,
  choice: Record<string, Choice>,
): E {
  const out: E = structuredClone(ours)
  for (const f of specs) {
    if (f.kind === "list") {
      const m = merge3List(
        base ? f.get(base) : [],
        f.get(ours),
        f.get(theirs),
        f.idOf,
        f.equal,
      )
      const items = [...m.resolved]
      for (const c of m.conflicts) {
        const ch = choice[`${f.id}:${c.key}`]
        if (ch === "theirs") {
          if (c.theirs) items.push(c.theirs)
        } else if (ch === "both") {
          if (c.ours) items.push(c.ours)
          if (c.theirs) items.push(c.theirs)
        } else if (c.ours) {
          items.push(c.ours)
        }
      }
      f.set(out, items)
      continue
    }
    const cmp = f.kind === "blob" ? f.compare : f.get
    const m = merge3Scalar(base ? cmp(base) : undefined, cmp(ours), cmp(theirs))
    let source = ours
    if (!m.conflict) {
      if (cmp(ours) !== cmp(theirs) && base && cmp(ours) === cmp(base))
        source = theirs
    } else if (choice[f.id] === "theirs") {
      source = theirs
    }
    if (f.kind === "blob") f.copy(source, out)
    else f.set(out, f.get(source))
  }
  return out
}

/** Return a clone of `working` with the single field `key` restored to its
 * committed (`oldE`) value — the engine behind per-field discard. */
export function revertField<E>(
  specs: Field<E>[],
  oldE: E | null,
  working: E,
  key: string,
): E {
  const out: E = structuredClone(working)
  const idx = key.indexOf(":")
  const specId = idx >= 0 ? key.slice(0, idx) : key
  const itemId = idx >= 0 ? key.slice(idx + 1) : undefined

  const f = specs.find((s) => s.id === specId)
  if (!f) return out
  if (f.kind === "list" && itemId !== undefined) {
    const oldItem = (oldE ? f.get(oldE) : []).find((i) => f.idOf(i) === itemId)
    const without = f.get(out).filter((i) => f.idOf(i) !== itemId)
    f.set(out, oldItem ? [...without, oldItem] : without)
  } else if (f.kind === "blob") {
    if (oldE) f.copy(oldE, out)
  } else if (f.kind === "scalar") {
    f.set(out, oldE ? f.get(oldE) : "")
  }
  return out
}
