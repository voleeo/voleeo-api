import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type HiddenRange,
  hiddenCount,
  mergeRanges,
  toRealLine,
  toVisualLine,
} from "@/lib/lineFolds"

/** Folding for the windowed viewer: tracks which block-opening lines are
 *  collapsed and maps between visual rows (what the virtualizer counts) and
 *  real line indices (what the backend windows and searches). */
export function useLineFolds(
  total: number,
  getFoldEnd: (line: number) => number | undefined,
  resetKey: string,
) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())

  // Keep the empty set's identity when it's already empty — a fresh Set would
  // rebuild `ranges` and both maps, re-firing every effect that depends on them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — fires on resetKey change
  useEffect(
    () => setCollapsed((c) => (c.size ? new Set<number>() : c)),
    [resetKey],
  )

  const ranges = useMemo(() => {
    const rs: HiddenRange[] = []
    for (const start of collapsed) {
      const end = getFoldEnd(start)
      if (end && end > start) rs.push([start + 1, end])
    }
    return mergeRanges(rs)
  }, [collapsed, getFoldEnd])

  const toReal = useCallback(
    (visual: number) => toRealLine(ranges, visual),
    [ranges],
  )
  const toVisual = useCallback(
    (real: number) => toVisualLine(ranges, real),
    [ranges],
  )

  const toggle = useCallback((line: number) => {
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(line)) next.add(line)
      return next
    })
  }, [])

  /** Open every fold hiding `line`, so a search hit can be scrolled to. */
  const reveal = useCallback(
    (line: number) => {
      setCollapsed((c) => {
        const next = new Set(c)
        for (const start of c) {
          const end = getFoldEnd(start)
          if (end && line > start && line <= end) next.delete(start)
        }
        return next.size === c.size ? c : next
      })
    },
    [getFoldEnd],
  )

  return {
    collapsed,
    visibleCount: total - hiddenCount(ranges),
    toReal,
    toVisual,
    toggle,
    reveal,
  }
}
