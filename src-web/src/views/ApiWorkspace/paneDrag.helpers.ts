import type { WorkspaceSettings } from "../../../../packages/types/bindings"

// Dragging the tree separator narrower than this collapses the tree entirely.
export const TREE_COLLAPSE_PX = 80

// Dragging the center↔response separator until either pane is narrower than this
// collapses that pane to a strip.
export const PANE_COLLAPSE_PX = 75

// Internal type with non-nullable numbers (PanelSizes fields are number|null from specta)
export type Sizes = {
  colPane1: number
  colPane3: number
  rowTree: number
  rowInner: number
}

export const DEFAULTS: Sizes = {
  colPane1: 20,
  colPane3: 38,
  rowTree: 20,
  rowInner: 50,
}

// Module-level cache eliminates the default-size flash when revisiting a workspace
export const sizeCache = new Map<string, Sizes>()

export function resolve(ws: WorkspaceSettings): Sizes {
  const ps = ws.panelSizes
  return {
    colPane1: ps?.colPane1 ?? DEFAULTS.colPane1,
    colPane3: ps?.colPane3 ?? DEFAULTS.colPane3,
    rowTree: ps?.rowTree ?? DEFAULTS.rowTree,
    rowInner: ps?.rowInner ?? DEFAULTS.rowInner,
  }
}

export type SepId = "colSep1" | "colSep2" | "rowOuter" | "rowInner"

export interface Drag {
  sep: SepId
  dir: "h" | "v" // horizontal or vertical
  startPos: number // clientX for h, clientY for v
  startPct: number
  fixedPct: number // locked panel's % (colSep1 locks colPane3; colSep2 locks colPane1)
  containerSize: number
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Which side of the center↔response separator (`colSep2`/`rowInner`) has been
 *  dragged below the collapse threshold, or null. */
export function paneCollapseSide(
  d: Drag,
  delta: number,
  cw: number,
): "center" | "response" | null {
  let centerPx: number
  let responsePx: number
  if (d.sep === "colSep2") {
    const p3 = d.startPct - delta // response %
    responsePx = (p3 / 100) * cw
    centerPx = ((100 - d.fixedPct - p3) / 100) * cw // fixedPct = colPane1
  } else {
    const pi = d.startPct + delta // center (top) %; cw is the height here
    centerPx = (pi / 100) * cw
    responsePx = ((100 - pi) / 100) * cw
  }
  if (responsePx < PANE_COLLAPSE_PX) return "response"
  if (centerPx < PANE_COLLAPSE_PX) return "center"
  return null
}

/** New sizes for an in-progress resize drag (no collapse). */
export function resizeSizes(d: Drag, delta: number, prev: Sizes): Sizes {
  if (d.sep === "colSep1") {
    return { ...prev, colPane1: clamp(d.startPct + delta, 0, 100 - d.fixedPct) }
  }
  if (d.sep === "colSep2") {
    return { ...prev, colPane3: clamp(d.startPct - delta, 0, 100 - d.fixedPct) }
  }
  if (d.sep === "rowOuter") {
    return { ...prev, rowTree: clamp(d.startPct + delta, 0, 100) }
  }
  return { ...prev, rowInner: clamp(d.startPct + delta, 0, 100) }
}
