import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

// Re-attach when the view is within this many px of the bottom.
const STICK_THRESHOLD = 40

/** Re-pin to the bottom whenever `signal` changes — pass the newest row's id/time
 *  so it changes once per content update, NOT on measurement jitter (chasing that
 *  would feedback-loop pin → scrollTop → re-measure into a hard freeze). Runs only
 *  while following (`stick`) and `enabled`. */
export function useFollowTail(
  pin: () => void,
  stick: RefObject<boolean>,
  signal: unknown,
  enabled = true,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: signal is the re-pin trigger, not a read value
  useEffect(() => {
    if (!enabled || !stick.current) return
    const id = requestAnimationFrame(pin)
    return () => cancelAnimationFrame(id)
  }, [signal, enabled, pin])
}

export function useStickToBottom() {
  const parentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const setFollowing = useCallback((v: boolean) => {
    stick.current = v
    setAtBottom(v) // React bails when unchanged, so no churn during streaming.
  }, [])

  const pin = useCallback(() => {
    const el = parentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const recomputeStick = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD)
      setFollowing(true)
  }, [setFollowing])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY < 0 && stick.current) setFollowing(false)
    },
    [setFollowing],
  )

  const scrollToBottom = useCallback(() => {
    pin()
    setFollowing(true)
  }, [pin, setFollowing])

  return {
    parentRef,
    stick,
    atBottom,
    pin,
    recomputeStick,
    onWheel,
    scrollToBottom,
  }
}
