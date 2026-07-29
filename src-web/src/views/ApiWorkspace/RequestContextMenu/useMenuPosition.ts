import { type RefObject, useLayoutEffect, useState } from "react"

const MARGIN = 8
/** Submenus are `min-w-[150px]`; assumed, since they don't exist to measure yet. */
const SUB_WIDTH = 150

const clamp = (v: number, max: number) =>
  Math.max(MARGIN, Math.min(v, max - MARGIN))

/**
 * Viewport-clamped placement for a `position: fixed` context menu: flips past
 * the anchor when it doesn't fit, then clamps for anchors near an edge.
 * Measures once per open, pre-paint — never in render (AGENTS.md rule 11).
 */
export function useMenuPosition(
  x: number,
  y: number,
  ref: RefObject<HTMLDivElement | null>,
) {
  const [pos, setPos] = useState({ top: y, left: x, subFlipLeft: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = clamp(x + width > vw - MARGIN ? x - width : x, vw - width)
    setPos({
      left,
      top: clamp(y + height > vh - MARGIN ? y - height : y, vh - height),
      subFlipLeft: left + width + SUB_WIDTH > vw - MARGIN,
    })
  }, [x, y, ref])

  return {
    style: { top: pos.top, left: pos.left },
    subFlipLeft: pos.subFlipLeft,
  }
}
