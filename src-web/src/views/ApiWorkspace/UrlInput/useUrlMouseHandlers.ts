import type React from "react"
import type { RefObject } from "react"
import { useEffect, useRef } from "react"
import {
  attachAtomSnapListener,
  getAnchorOffset,
  getChipRanges,
  getFocusOffset,
  setSelectionExtended,
} from "@/lib/caret"

interface UseUrlMouseHandlersOptions {
  divRef: RefObject<HTMLDivElement | null>
  /** Invoked on a pure click (no drag) targeting a chip span. */
  onChipClick: (target: HTMLElement) => void
}

/**
 * Pointer/drag mechanics for the URL chip editor: atom-snap during drag,
 * snapping a drag-selection to whole chip boundaries, and distinguishing a
 * pure click from a drag-select so chip clicks don't fire mid-selection.
 */
export function useUrlMouseHandlers({
  divRef,
  onChipClick,
}: UseUrlMouseHandlersOptions) {
  // Active pointer drag — lets the atom-snap listener prefer snapping before a
  // chip (enabling right-drag to include the chip).
  const isDragging = useRef(false)
  // mousedown position, so handleClick can detect drag vs. pure click.
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)

  // Native mousedown/mouseup set isDragging before selectionchange fires so the
  // atom-snap listener (chips behave as single characters) can use it.
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    const onDown = () => {
      isDragging.current = true
    }
    const onUp = () => {
      isDragging.current = false
    }
    el.addEventListener("mousedown", onDown)
    document.addEventListener("mouseup", onUp)
    const cleanup = attachAtomSnapListener(el, { isDragging })
    return () => {
      el.removeEventListener("mousedown", onDown)
      document.removeEventListener("mouseup", onUp)
      cleanup()
    }
  }, [divRef])

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    mouseDownPos.current = { x: e.clientX, y: e.clientY }
  }

  // Snap a drag-selection to whole chip boundaries (mirrors CodeMirror atomicRanges).
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.buttons & 1) || !divRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const el = divRef.current
    const anchor = getAnchorOffset(el)
    const focus = getFocusOffset(el)
    for (const chip of getChipRanges(el)) {
      // Focus inside chip, dragging rightward — snap past it.
      if (anchor <= chip.start && focus > chip.start && focus < chip.end) {
        setSelectionExtended(el, anchor, chip.end)
        return
      }
      // Focus inside chip, dragging leftward — snap before it.
      if (anchor >= chip.end && focus > chip.start && focus < chip.end) {
        setSelectionExtended(el, anchor, chip.start)
        return
      }
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.tagName !== "SPAN") return
    // If the mouse moved more than 4 px between mousedown and click, the user
    // was drag-selecting — preserve the selection and don't open any modal.
    const down = mouseDownPos.current
    if (down) {
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      if (dx * dx + dy * dy > 16) return
    }
    onChipClick(target)
  }

  return { handleMouseDown, handleMouseMove, handleClick }
}
