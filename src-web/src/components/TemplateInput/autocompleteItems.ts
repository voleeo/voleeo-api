import type { BoundTemplateFunction } from "@/plugins/types"

export interface ConstantSuggestion {
  value: string
  badge: string
  description?: string
}

export interface VarSuggestion {
  name: string
  system?: boolean
}

export type AutocompleteItem =
  | { kind: "var"; name: string; system?: boolean }
  | { kind: "func"; fn: BoundTemplateFunction }
  | { kind: "namespace"; prefix: string }
  | { kind: "constant"; value: string; badge: string; description?: string }
  | { kind: "schema"; label: string; detail: string }

export function deriveNamespaces(fns: BoundTemplateFunction[]): string[] {
  const seen = new Set<string>()
  for (const fn of fns) {
    let idx = fn.name.indexOf(".")
    while (idx !== -1) {
      seen.add(fn.name.slice(0, idx))
      idx = fn.name.indexOf(".", idx + 1)
    }
  }
  return [...seen]
}

function longestNsPrefix(q: string, namespaces: string[]): string | null {
  let best: string | null = null
  for (const ns of namespaces) {
    if (q !== ns && !q.startsWith(`${ns}.`)) continue
    if (!best || ns.length > best.length) best = ns
  }
  return best
}

export function buildItems(
  query: string,
  varNames: VarSuggestion[],
  fns: BoundTemplateFunction[],
  nsFilter: string | null,
  constantItems?: ConstantSuggestion[],
): AutocompleteItem[] {
  const q = query.toLowerCase()
  const namespaces = deriveNamespaces(fns)
  const effectiveNs = nsFilter ?? longestNsPrefix(q, namespaces)
  const subQuery =
    effectiveNs && q.length > effectiveNs.length
      ? q.slice(effectiveNs.length + 1)
      : effectiveNs
        ? ""
        : q

  const items: AutocompleteItem[] = []

  // Constant suggestions always appear first (only provided in non-template ctx).
  if (constantItems) {
    for (const c of constantItems) {
      if (!q || c.value.toLowerCase().includes(q)) {
        items.push({
          kind: "constant",
          value: c.value,
          badge: c.badge,
          description: c.description,
        })
      }
    }
  }

  if (effectiveNs) {
    // Leaf functions directly under this namespace (no further dot in local name)
    for (const fn of fns) {
      if (!fn.name.startsWith(`${effectiveNs}.`)) continue
      const localName = fn.name.slice(effectiveNs.length + 1)
      if (localName.includes(".")) continue
      if (subQuery && !localName.toLowerCase().includes(subQuery)) continue
      items.push({ kind: "func", fn })
    }
    // Immediate sub-namespaces
    for (const ns of namespaces) {
      if (!ns.startsWith(`${effectiveNs}.`)) continue
      const localNs = ns.slice(effectiveNs.length + 1)
      if (localNs.includes(".")) continue
      if (subQuery && !localNs.toLowerCase().includes(subQuery)) continue
      items.push({ kind: "namespace", prefix: ns })
    }
  } else {
    const matchedVars = varNames.filter(
      (v) => !q || v.name.toLowerCase().includes(q),
    )
    if (q) {
      matchedVars.sort((a, b) => {
        const ai = a.name.toLowerCase().indexOf(q)
        const bi = b.name.toLowerCase().indexOf(q)
        return ai - bi || a.name.length - b.name.length
      })
    }
    for (const v of matchedVars) {
      items.push({ kind: "var", name: v.name, system: v.system })
    }

    // Top-level functions (no dot)
    for (const fn of fns) {
      if (fn.name.includes(".")) continue
      if (q && !fn.name.toLowerCase().includes(q)) continue
      items.push({ kind: "func", fn })
    }

    // Top-level namespaces only
    for (const prefix of namespaces) {
      if (prefix.includes(".")) continue
      if (
        q &&
        !prefix.toLowerCase().startsWith(q) &&
        !prefix.toLowerCase().includes(q)
      )
        continue
      items.push({ kind: "namespace", prefix })
    }
  }

  return items
}
