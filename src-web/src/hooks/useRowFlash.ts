import { useEffect, useRef } from "react"

// Newest nonce whose flash already ran (nonces are performance.now(), so
// strictly increasing). Collapsing/expanding the System block remounts its
// rows with the SAME still-active flash target — without this a single click
// would re-flash on every expand. Only a fresh click (newer nonce) fires again.
let lastConsumedNonce = -1

/** Fire a one-shot `.env-row-flash` on the returned ref's element whenever
 *  `active` is true; `nonce` re-fires it for repeat clicks of the same target
 *  (same key → prop unchanged → the class would otherwise not restart). Also
 *  scrolls the row into view so a navigated-to var is never off-screen. */
export function useRowFlash<T extends HTMLElement>(
  active: boolean,
  nonce: number | undefined,
  padded = false,
) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active || nonce === undefined) return
    const el = ref.current
    if (!el) return
    const classes = padded
      ? ["env-row-flash", "env-row-flash-pad"]
      : ["env-row-flash"]
    if (nonce > lastConsumedNonce) {
      lastConsumedNonce = nonce
      el.classList.remove(...classes)
      void el.offsetWidth // reflow so the animation restarts from 0
      el.classList.add(...classes)
      el.scrollIntoView({ block: "nearest" })
    }
    // (Re-)attach outside the consume guard: StrictMode re-runs the effect
    // after cleanup detached the listener — without this the classes linger.
    const done = () => el.classList.remove(...classes)
    el.addEventListener("animationend", done, { once: true })
    return () => el.removeEventListener("animationend", done)
  }, [active, nonce, padded])
  return ref
}
