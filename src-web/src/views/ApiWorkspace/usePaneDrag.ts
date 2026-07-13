import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { patchSettings } from "@/lib/workspaceSettings"
import { useUiStore } from "@/store/workspace"
import type { WorkspaceSettings } from "../../../../packages/types/bindings"
import { commands } from "../../../../packages/types/bindings"

// Dragging the tree separator narrower than this collapses the tree entirely.
const TREE_COLLAPSE_PX = 80

// Dragging the center↔response separator until either pane is narrower than this
// collapses that pane to a strip.
const PANE_COLLAPSE_PX = 75

// Pixel minimums for each pane. All are unconstrained (0) so separators drag
// freely; the tree instead collapses entirely once it shrinks past
// `TREE_COLLAPSE_PX` (handled in onMove).
const TREE_MIN = 0
const REQUEST_MIN = 0
const RESPONSE_MIN = 0
const ROW_TREE_MIN = 0
const ROW_RIGHT_MIN = 0
const ROW_REQUEST_MIN = 0
const ROW_RESPONSE_MIN = 0

// Internal type with non-nullable numbers (PanelSizes fields are number|null from specta)
type Sizes = {
  colPane1: number
  colPane3: number
  rowTree: number
  rowInner: number
}

const DEFAULTS: Sizes = {
  colPane1: 20,
  colPane3: 38,
  rowTree: 20,
  rowInner: 50,
}

// Module-level cache eliminates the default-size flash when revisiting a workspace
const sizeCache = new Map<string, Sizes>()

function resolve(ws: WorkspaceSettings): Sizes {
  const ps = ws.panelSizes
  return {
    colPane1: ps?.colPane1 ?? DEFAULTS.colPane1,
    colPane3: ps?.colPane3 ?? DEFAULTS.colPane3,
    rowTree: ps?.rowTree ?? DEFAULTS.rowTree,
    rowInner: ps?.rowInner ?? DEFAULTS.rowInner,
  }
}

type SepId = "colSep1" | "colSep2" | "rowOuter" | "rowInner"

interface Drag {
  sep: SepId
  dir: "h" | "v" // horizontal or vertical
  startPos: number // clientX for h, clientY for v
  startPct: number
  fixedPct: number // locked panel's % (colSep1 locks colPane3; colSep2 locks colPane1)
  containerSize: number
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function usePaneDrag(
  wsId: string,
  colRef: React.RefObject<HTMLDivElement | null>,
  rowRef: React.RefObject<HTMLDivElement | null>,
  innerRef: React.RefObject<HTMLDivElement | null>,
  // Dragging the center↔response separator until one side shrinks past
  // PANE_COLLAPSE_PX collapses that side (request or response) to a strip.
  onCollapse?: (which: "center" | "response") => void,
) {
  const onCollapseRef = useRef(onCollapse)
  onCollapseRef.current = onCollapse
  const [sizes, setSizes] = useState<Sizes>(
    () => sizeCache.get(wsId) ?? DEFAULTS,
  )

  // Refs mirror state so stable closures always see the latest values
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  const wsIdRef = useRef(wsId)
  wsIdRef.current = wsId
  const dragRef = useRef<Drag | null>(null)

  // Load from disk when workspace changes; cancel any in-progress drag
  useEffect(() => {
    dragRef.current = null
    const cached = sizeCache.get(wsId)
    if (cached) {
      setSizes(cached)
      return
    }
    commands
      .workspaceGetSettings(wsId)
      .then((res) => {
        if (res.status !== "ok") return
        const s = resolve(res.data)
        sizeCache.set(wsId, s)
        setSizes(s)
      })
      .catch(() => {})
  }, [wsId])

  // Single document-level listener handles all four separators
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current
      if (!d) return
      const pos = d.dir === "h" ? e.clientX : e.clientY
      const delta = ((pos - d.startPos) / d.containerSize) * 100
      const cw = d.containerSize

      // Tree separator dragged below the collapse threshold → hide the tree and
      // end the drag. Reset the stored width so it reopens at a sane size.
      if (d.sep === "colSep1" || d.sep === "rowOuter") {
        const rawPx = ((d.startPct + delta) / 100) * cw
        if (rawPx < TREE_COLLAPSE_PX) {
          dragRef.current = null
          document.body.style.cursor = ""
          document.body.style.userSelect = ""
          const reset: Sizes =
            d.sep === "colSep1"
              ? { ...sizesRef.current, colPane1: DEFAULTS.colPane1 }
              : { ...sizesRef.current, rowTree: DEFAULTS.rowTree }
          sizesRef.current = reset
          setSizes(reset)
          sizeCache.set(wsIdRef.current, reset)
          patchSettings(wsIdRef.current, { panelSizes: reset })
          const ui = useUiStore.getState()
          if (ui.treeVisible) ui.toggleTreeVisible()
          return
        }
      }

      // Center↔response separator dragged until one side is too small → collapse
      // that side to a strip and reset its stored size so it re-expands sanely.
      if (
        (d.sep === "colSep2" || d.sep === "rowInner") &&
        onCollapseRef.current
      ) {
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
        const which =
          responsePx < PANE_COLLAPSE_PX
            ? "response"
            : centerPx < PANE_COLLAPSE_PX
              ? "center"
              : null
        if (which) {
          dragRef.current = null
          document.body.style.cursor = ""
          document.body.style.userSelect = ""
          const key = d.sep === "colSep2" ? "colPane3" : "rowInner"
          const reset: Sizes = { ...sizesRef.current, [key]: DEFAULTS[key] }
          sizesRef.current = reset
          setSizes(reset)
          sizeCache.set(wsIdRef.current, reset)
          patchSettings(wsIdRef.current, { panelSizes: reset })
          onCollapseRef.current(which)
          return
        }
      }

      setSizes((prev) => {
        let next: Sizes = prev
        if (d.sep === "colSep1") {
          const p1 = clamp(
            d.startPct + delta,
            (TREE_MIN / cw) * 100,
            100 - d.fixedPct - (REQUEST_MIN / cw) * 100,
          )
          next = { ...prev, colPane1: p1 }
        } else if (d.sep === "colSep2") {
          const p3 = clamp(
            d.startPct - delta,
            (RESPONSE_MIN / cw) * 100,
            100 - d.fixedPct - (REQUEST_MIN / cw) * 100,
          )
          next = { ...prev, colPane3: p3 }
        } else if (d.sep === "rowOuter") {
          const pt = clamp(
            d.startPct + delta,
            (ROW_TREE_MIN / cw) * 100,
            100 - (ROW_RIGHT_MIN / cw) * 100,
          )
          next = { ...prev, rowTree: pt }
        } else {
          const pi = clamp(
            d.startPct + delta,
            (ROW_REQUEST_MIN / cw) * 100,
            100 - (ROW_RESPONSE_MIN / cw) * 100,
          )
          next = { ...prev, rowInner: pi }
        }
        sizesRef.current = next // keep ref current between renders during drag
        return next
      })
    }

    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      const s = sizesRef.current
      const id = wsIdRef.current
      sizeCache.set(id, s)
      patchSettings(id, { panelSizes: s })
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  function startDrag(e: React.MouseEvent, sep: SepId) {
    e.preventDefault()
    const isRow = sep === "rowInner"
    document.body.style.cursor = isRow ? "row-resize" : "col-resize"
    document.body.style.userSelect = "none"
    const s = sizesRef.current
    const ref =
      sep === "rowInner" ? innerRef : sep === "rowOuter" ? rowRef : colRef
    const el = ref.current
    const containerSize = isRow
      ? (el?.offsetHeight ?? 600)
      : (el?.offsetWidth ?? 1000)
    const startPct =
      sep === "colSep1"
        ? s.colPane1
        : sep === "colSep2"
          ? s.colPane3
          : sep === "rowOuter"
            ? s.rowTree
            : s.rowInner
    const fixedPct =
      sep === "colSep1" ? s.colPane3 : sep === "colSep2" ? s.colPane1 : 0
    dragRef.current = {
      sep,
      dir: isRow ? "v" : "h",
      startPos: isRow ? e.clientY : e.clientX,
      startPct,
      fixedPct,
      containerSize,
    }
  }

  // Double-click a separator to reset it: the tree separator snaps the tree to
  // a fixed 260px; the request/response separator splits its two panes 50/50.
  const TREE_RESET_PX = 260
  function centerSep(sep: SepId) {
    setSizes((prev) => {
      let next: Sizes = prev
      if (sep === "colSep1") {
        const w = colRef.current?.offsetWidth ?? 1000
        const pct = clamp((TREE_RESET_PX / w) * 100, 0, 100 - prev.colPane3)
        next = { ...prev, colPane1: pct }
      } else if (sep === "colSep2") {
        next = { ...prev, colPane3: (100 - prev.colPane1) / 2 }
      } else if (sep === "rowOuter") {
        const w = rowRef.current?.offsetWidth ?? 1000
        next = { ...prev, rowTree: clamp((TREE_RESET_PX / w) * 100, 0, 100) }
      } else {
        next = { ...prev, rowInner: 50 }
      }
      sizesRef.current = next
      return next
    })
    const s = sizesRef.current
    const id = wsIdRef.current
    sizeCache.set(id, s)
    patchSettings(id, { panelSizes: s })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads only stable refs
  const onColSep1DoubleClick = useCallback(() => centerSep("colSep1"), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads only stable refs
  const onColSep2DoubleClick = useCallback(() => centerSep("colSep2"), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads only stable refs
  const onRowOuterDoubleClick = useCallback(() => centerSep("rowOuter"), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads only stable refs
  const onRowInnerDoubleClick = useCallback(() => centerSep("rowInner"), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: startDrag reads only stable refs; no reactive deps
  const onColSep1Down = useCallback(
    (e: React.MouseEvent) => startDrag(e, "colSep1"),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: startDrag is stable (refs only)
  const onColSep2Down = useCallback(
    (e: React.MouseEvent) => startDrag(e, "colSep2"),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: startDrag is stable (refs only)
  const onRowOuterSepDown = useCallback(
    (e: React.MouseEvent) => startDrag(e, "rowOuter"),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: startDrag is stable (refs only)
  const onRowInnerSepDown = useCallback(
    (e: React.MouseEvent) => startDrag(e, "rowInner"),
    [],
  )

  return {
    sizes,
    onColSep1Down,
    onColSep2Down,
    onRowOuterSepDown,
    onRowInnerSepDown,
    onColSep1DoubleClick,
    onColSep2DoubleClick,
    onRowOuterDoubleClick,
    onRowInnerDoubleClick,
  }
}
