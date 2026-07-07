/** Shared cap so live transcripts/timelines (WS, gRPC, SSE) can't grow
 *  without bound on a long-lived connection. Drops oldest entries first. */
export const LIVE_HISTORY_CAP = 2000

/** Appends `item` to `prev`, dropping the oldest entry if over `cap`. */
export function capPush<T>(prev: T[], item: T, cap = LIVE_HISTORY_CAP): T[] {
  const next = [...prev, item]
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Appends a batch in one shot — O(prev + batch) per flush, not per item, so
 *  a fast stream doesn't re-clone a capped array on every event. */
export function capPushMany<T>(
  prev: T[],
  items: T[],
  cap = LIVE_HISTORY_CAP,
): T[] {
  if (items.length === 0) return prev
  const combined = [...prev, ...items]
  return combined.length > cap ? combined.slice(-cap) : combined
}
