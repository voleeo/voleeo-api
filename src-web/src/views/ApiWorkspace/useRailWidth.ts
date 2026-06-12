import type React from "react"
import { useCallback, useRef, useState } from "react"
import { useStableDrag } from "@/hooks/useStableDrag"

const STORAGE_KEY = "voleeo:graphqlDocsWidth"

export function useRailWidth(defaultPx = 340, min = 240, max = 680) {
  const [width, setWidth] = useState<number>(() => {
    const raw = Number(localStorage.getItem(STORAGE_KEY))
    return raw >= min && raw <= max ? raw : defaultPx
  })

  const widthRef = useRef(width)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useStableDrag(
    (e) => {
      const d = dragRef.current
      if (!d) return
      const next = Math.max(
        min,
        Math.min(max, d.startWidth + (d.startX - e.clientX)),
      )
      widthRef.current = next
      setWidth(next)
    },
    () => {
      if (!dragRef.current) return
      dragRef.current = null
      try {
        localStorage.setItem(STORAGE_KEY, String(widthRef.current))
      } catch {}
    },
  )

  const onSepDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: widthRef.current }
      startDrag()
    },
    [startDrag],
  )

  return { width, onSepDown }
}
