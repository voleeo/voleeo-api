import { useCallback, useEffect, useRef } from "react"

export function useStableDrag(
  onMove: (e: MouseEvent) => void,
  onEnd: () => void,
) {
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  const handlers = useRef<{
    move: (e: MouseEvent) => void
    up: () => void
  } | null>(null)
  if (!handlers.current) {
    const move = (e: MouseEvent) => onMoveRef.current(e)
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      document.body.style.userSelect = ""
      onEndRef.current()
    }
    handlers.current = { move, up }
  }

  const start = useCallback(() => {
    if (!handlers.current) return
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", handlers.current.move)
    window.addEventListener("mouseup", handlers.current.up)
  }, [])

  useEffect(
    () => () => {
      if (!handlers.current) return
      window.removeEventListener("mousemove", handlers.current.move)
      window.removeEventListener("mouseup", handlers.current.up)
    },
    [],
  )

  return start
}
