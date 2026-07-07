import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { patchSettings } from "@/lib/workspaceSettings"
import type { WorkspaceSettings } from "../../../../packages/types/bindings"
import { commands } from "../../../../packages/types/bindings"

// Pixel minimums for each pane
const TREE_MIN = 160
const REQUEST_MIN = 380
const RESPONSE_MIN = 380
const ROW_TREE_MIN = 160
const ROW_RIGHT_MIN = 400
const ROW_REQUEST_MIN = 180
const ROW_RESPONSE_MIN = 150

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
) {
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
  }
}
