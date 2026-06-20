import type {
  ImportFormat,
  ImportNode_Serialize as ImportNode,
} from "../../../../../packages/types/bindings"

/** Total number of request (leaf) nodes in the tree. */
export function totalRequests(nodes: ImportNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.kind === "request") n++
    else n += totalRequests(node.children)
  }
  return n
}

/** Selected/total request counts under a node (recursive, requests only). */
export function folderCounts(
  node: ImportNode,
  selected: Set<string>,
): { selected: number; total: number } {
  let sel = 0
  let total = 0
  for (const child of node.children) {
    if (child.kind === "request") {
      total++
      if (selected.has(child.id)) sel++
    } else {
      const c = folderCounts(child, selected)
      sel += c.selected
      total += c.total
    }
  }
  return { selected: sel, total }
}

/** A node's own id plus every descendant id (folders + requests). */
export function collectIds(
  node: ImportNode,
  out: Set<string> = new Set(),
): Set<string> {
  out.add(node.id)
  for (const c of node.children) collectIds(c, out)
  return out
}

/** Every descendant request id (leaves) under the given nodes. */
export function requestIds(nodes: ImportNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "request") out.push(node.id)
    else requestIds(node.children, out)
  }
  return out
}

/**
 * Filter the tree by free-text (name or path). Folders survive when any
 * descendant request matches; matching requests keep their place.
 */
export function filterTree(nodes: ImportNode[], query: string): ImportNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const out: ImportNode[] = []
  for (const node of nodes) {
    if (node.kind === "request") {
      if (
        node.name.toLowerCase().includes(q) ||
        (node.path ?? "").toLowerCase().includes(q)
      ) {
        out.push(node)
      }
    } else {
      const children = filterTree(node.children, query)
      if (children.length > 0) out.push({ ...node, children })
    }
  }
  return out
}

/** Human label for the source-format subtitle, e.g. "OpenAPI 3.0". */
const FORMAT_LABELS: Record<ImportFormat, string> = {
  open_api: "OpenAPI",
  swagger2: "Swagger",
  postman: "Postman",
  insomnia: "Insomnia",
  bruno: "Bruno",
  yaak: "Yaak",
}

export function formatLabel(
  format: ImportFormat,
  version?: string | null,
): string {
  const base = FORMAT_LABELS[format] ?? format
  // Bruno/Yaak "versions" are internal schema numbers, not a spec version to show.
  if (format === "bruno" || format === "yaak") return base
  // Show only the major.minor of a semver-ish version (3.0.3 → 3.0).
  const short = version?.split(".").slice(0, 2).join(".")
  return short ? `${base} ${short}` : base
}
