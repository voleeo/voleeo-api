import { useCallback, useRef, useState } from "react"

const STICK_THRESHOLD = 40

export function useStickToBottom() {
  const parentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const recomputeStick = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const at =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    stick.current = at
    setAtBottom(at)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stick.current = true
    setAtBottom(true)
  }, [])

  return { parentRef, stick, atBottom, recomputeStick, scrollToBottom }
}
