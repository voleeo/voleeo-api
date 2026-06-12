import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useStableDrag } from "@/hooks/useStableDrag"

interface Options {
  value: number
  min?: number
  max?: number
  onCommit?: (topPct: number) => void
}

export function useVerticalSplit({
  value,
  min = 15,
  max = 85,
  onCommit,
}: Options) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [topPct, setTopPct] = useState(value)
  const dragRef = useRef<{ top: number; height: number } | null>(null)
  const topPctRef = useRef(topPct)

  const startDrag = useStableDrag(
    (e) => {
      const d = dragRef.current
      if (!d || d.height === 0) return
      const pct = ((e.clientY - d.top) / d.height) * 100
      const clamped = Math.max(min, Math.min(max, pct))
      topPctRef.current = clamped
      setTopPct(clamped)
    },
    () => {
      if (!dragRef.current) return
      dragRef.current = null
      onCommit?.(topPctRef.current)
    },
  )

  const onSepDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const el = containerRef.current
      if (!el) return
      // getBoundingClientRect in the handler (not render) — rule 11.
      const rect = el.getBoundingClientRect()
      dragRef.current = { top: rect.top, height: rect.height }
      startDrag()
    },
    [startDrag],
  )

  // Re-sync to the external value when not mid-drag (request switch / restore).
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (dragRef.current || value === prevValueRef.current) return
    prevValueRef.current = value
    topPctRef.current = value
    setTopPct(value)
  }, [value])

  return { containerRef, topPct, onSepDown }
}
