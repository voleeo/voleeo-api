import { useCallback, useEffect, useMemo, useState } from "react"
import type { SseFrame } from "@/store/sse"

function matchesQuery(f: SseFrame, q: string): boolean {
  if (!q) return true
  const ql = q.toLowerCase()
  return (
    f.data.toLowerCase().includes(ql) ||
    (f.event ?? "message").toLowerCase().includes(ql)
  )
}

export interface SseView {
  filter: string
  setFilter: (f: string) => void
  query: string
  setQuery: (q: string) => void
  searchOpen: boolean
  setSearchOpen: (v: boolean) => void
  raw: boolean
  setRaw: (v: boolean) => void
  open: Set<number>
  toggleOne: (seq: number) => void
  types: { type: string; count: number }[]
  filtered: SseFrame[]
  total: number
}

/** Owns the SSE Stream view's UI state (filter, search, expand set) so the
 *  tab-bar buttons, the filter pane, and the frame list can all share it. */
export function useSseView(
  frames: SseFrame[],
  requestId: string | null,
): SseView {
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpenRaw] = useState(false)
  const [raw, setRaw] = useState(false)
  const [open, setOpen] = useState<Set<number>>(() => new Set())

  // Disabling search clears the query + filter, so the user sees the full list
  // again instead of a stale filtered subset.
  const setSearchOpen = useCallback((v: boolean) => {
    setSearchOpenRaw(v)
    if (!v) {
      setFilter("all")
      setQuery("")
    }
  }, [])

  // Reset the whole view when switching requests.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on request change
  useEffect(() => {
    setFilter("all")
    setQuery("")
    setSearchOpenRaw(false)
    setRaw(false)
    setOpen(new Set())
  }, [requestId])

  const types = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of frames) {
      const ev = f.event ?? "message"
      m.set(ev, (m.get(ev) ?? 0) + 1)
    }
    return [...m.entries()].map(([type, count]) => ({ type, count }))
  }, [frames])

  const filtered = useMemo(
    () =>
      frames.filter(
        (f) =>
          (filter === "all" || (f.event ?? "message") === filter) &&
          matchesQuery(f, query),
      ),
    [frames, filter, query],
  )

  const toggleOne = useCallback((seq: number) => {
    setOpen((p) => {
      const n = new Set(p)
      if (n.has(seq)) n.delete(seq)
      else n.add(seq)
      return n
    })
  }, [])

  return {
    filter,
    setFilter,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    raw,
    setRaw,
    open,
    toggleOne,
    types,
    filtered,
    total: frames.length === 0 ? 0 : frames[frames.length - 1].seq + 1,
  }
}
