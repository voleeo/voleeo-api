import type { DropZone } from "@/components/ApiRequestTree/types"
import type { ApiFolder, MoveItemUpdate, TreeNode } from "@/store/requests"
import { effectiveOrder } from "@/store/requests"

/** A single entry in the depth-first, visibility-aware flattened tree. */
export type FlatNode = {
  id: string
  kind: "folder" | "request" | "websocket"
  /** ID of the containing folder, or null for top-level items. */
  parentId: string | null
  /** True when this is the first item inside its parent folder (used by Left arrow). */
  isFirstChild: boolean
}

/**
 * Returns a flat, ordered list of every visible node — folders are included
 * but their children are only added when the folder is open.
 */
export function flattenVisible(
  tree: TreeNode[],
  isFolderOpen: (id: string) => boolean,
  parentId: string | null = null,
): FlatNode[] {
  const result: FlatNode[] = []
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    const isFirstChild = parentId !== null && i === 0
    if (node.kind === "folder") {
      const id = node.folder.id
      result.push({ id, kind: "folder", parentId, isFirstChild })
      if (isFolderOpen(id)) {
        result.push(...flattenVisible(node.children, isFolderOpen, id))
      }
    } else if (node.kind === "websocket") {
      result.push({
        id: node.connection.id,
        kind: "websocket",
        parentId,
        isFirstChild,
      })
    } else {
      result.push({
        id: node.request.id,
        kind: "request",
        parentId,
        isFirstChild,
      })
    }
  }
  return result
}

export function getId(n: TreeNode) {
  if (n.kind === "folder") return n.folder.id
  if (n.kind === "websocket") return n.connection.id
  return n.request.id
}

export function getKind(n: TreeNode) {
  return n.kind
}

/** Map a tree node kind to the `ItemKind` the backend `move_items` expects. */
function toItemKind(kind: TreeNode["kind"]): MoveItemUpdate["kind"] {
  return kind === "websocket" ? "webSocket" : kind
}

export function findParent(
  nodes: TreeNode[],
  id: string,
  parent: string | null = null,
): string | null | undefined {
  for (const n of nodes) {
    if (getId(n) === id) return parent
    if (n.kind === "folder") {
      const r = findParent(n.children, id, n.folder.id)
      if (r !== undefined) return r
    }
  }
  return undefined
}

export function getChildren(
  nodes: TreeNode[],
  parentId: string | null,
): TreeNode[] | null {
  if (parentId === null) return nodes
  for (const n of nodes) {
    if (n.kind === "folder") {
      if (n.folder.id === parentId) return n.children
      const r = getChildren(n.children, parentId)
      if (r !== null) return r
    }
  }
  return null
}

/**
 * Walk up the ancestry chain from nodeId until we reach targetDepth.
 * Returns the ancestor's ID, or null if already at root or not found.
 */
export function findAncestorAtDepth(
  tree: TreeNode[],
  nodeId: string,
  nodeDepth: number,
  targetDepth: number,
): string | null {
  if (targetDepth >= nodeDepth) return null

  let currentId = nodeId
  let currentDepth = nodeDepth

  while (currentDepth > targetDepth) {
    const parentId = findParent(tree, currentId)
    if (typeof parentId !== "string") break // null (root) or undefined (not found)
    currentId = parentId
    currentDepth--
  }

  return currentDepth === targetDepth && currentId !== nodeId ? currentId : null
}

/**
 * Build a human-readable breadcrumb for a request's folder ancestry.
 * Returns `""` for root-level items, `"A > B"` for nested ones.
 */
export function getFolderPath(
  folders: ApiFolder[],
  folderId: string | null,
): string {
  const names: string[] = []
  let current = folderId
  while (current !== null) {
    const folder = folders.find((f) => f.id === current)
    if (!folder) break
    names.unshift(folder.name)
    current = folder.folderId ?? null
  }
  return names.join(" > ")
}

/**
 * Returns the IDs of all ancestor folders for a given `folderId`,
 * ordered from immediate parent up to root. Used to force-open
 * parent folders when navigating to a request from search/palette.
 */
export function getAncestorFolderIds(
  folders: ApiFolder[],
  folderId: string | null,
): string[] {
  const ids: string[] = []
  let current = folderId
  while (current !== null) {
    const folder = folders.find((f) => f.id === current)
    if (!folder) break
    ids.push(folder.id)
    current = folder.folderId ?? null
  }
  return ids
}

/**
 * Fractional ordering: compute ONE MoveItemUpdate for the dragged item.
 * New order = midpoint between its future neighbours.
 */
export function computeUpdate(
  tree: TreeNode[],
  draggingId: string,
  zone: DropZone,
): MoveItemUpdate | null {
  if (zone.id === draggingId) return null

  const srcParent = findParent(tree, draggingId)
  if (srcParent === undefined) return null

  const dragged = (getChildren(tree, srcParent) ?? []).find(
    (n) => getId(n) === draggingId,
  )
  if (!dragged) return null

  let dstParent: string | null
  let prev: number | null = null
  let next: number | null = null

  if (zone.type === "into") {
    dstParent = zone.id
    const kids = (getChildren(tree, zone.id) ?? []).filter(
      (n) => getId(n) !== draggingId,
    )
    prev = kids.length ? Math.max(...kids.map(effectiveOrder)) : null
  } else {
    const tp = findParent(tree, zone.id)
    if (tp === undefined) return null
    dstParent = tp

    const sibs = (getChildren(tree, dstParent) ?? []).filter(
      (n) => getId(n) !== draggingId,
    )
    const idx = sibs.findIndex((n) => getId(n) === zone.id)

    if (zone.type === "before") {
      prev = idx > 0 ? effectiveOrder(sibs[idx - 1]) : null
      next = idx >= 0 ? effectiveOrder(sibs[idx]) : null
    } else {
      prev = idx >= 0 ? effectiveOrder(sibs[idx]) : null
      next = idx + 1 < sibs.length ? effectiveOrder(sibs[idx + 1]) : null
    }
  }

  const order =
    prev === null && next === null
      ? 1000
      : prev === null
        ? (next ?? 1000) - 500
        : next === null
          ? prev + 1000
          : (prev + next) / 2

  return {
    id: draggingId,
    kind: toItemKind(getKind(dragged)),
    folderId: dstParent,
    order,
  }
}
