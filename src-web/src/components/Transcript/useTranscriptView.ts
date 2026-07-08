import { useCallback, useEffect, useMemo, useState } from "react"

const foldModeByKey = new Map<string, boolean>()

export interface TranscriptViewState<T> {
  query: string
  setQuery: (q: string) => void
  searchOpen: boolean
  setSearchOpen: (v: boolean) => void
  closeSearch: () => void
  isOpen: (id: string) => boolean
  toggleOne: (id: string) => void
  allExpanded: boolean
  toggleExpandAll: () => void
  foldSignal: string
  raw: boolean
  setRaw: (v: boolean) => void
  filtered: T[]
}

export function useTranscriptView<T extends { id: string; data: string }>(
  messages: T[],
  resetKey: string,
): TranscriptViewState<T> {
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpenRaw] = useState(false)
  const [raw, setRaw] = useState(false)
  const [allExpanded, setAllExpanded] = useState(
    () => foldModeByKey.get(resetKey) ?? false,
  )
  const [overrides, setOverrides] = useState<Set<string>>(() => new Set())

  // Reset the transient state when switching requests, but restore that
  // request's remembered fold mode.
  useEffect(() => {
    setQuery("")
    setSearchOpenRaw(false)
    setRaw(false)
    setAllExpanded(foldModeByKey.get(resetKey) ?? false)
    setOverrides(new Set())
  }, [resetKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((m) => m.data.toLowerCase().includes(q))
  }, [messages, query])

  // Turning search off clears the filter so the full list returns.
  const setSearchOpen = useCallback((v: boolean) => {
    setSearchOpenRaw(v)
    if (!v) setQuery("")
  }, [])
  const closeSearch = useCallback(() => setSearchOpen(false), [setSearchOpen])

  const isOpen = useCallback(
    (id: string) => allExpanded !== overrides.has(id),
    [allExpanded, overrides],
  )
  const toggleOne = useCallback((id: string) => {
    setOverrides((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])
  const toggleExpandAll = useCallback(() => {
    const next = !allExpanded
    foldModeByKey.set(resetKey, next)
    setAllExpanded(next)
    setOverrides(new Set())
  }, [allExpanded, resetKey])

  return {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    closeSearch,
    isOpen,
    toggleOne,
    allExpanded,
    toggleExpandAll,
    foldSignal: `${allExpanded}:${overrides.size}`,
    raw,
    setRaw,
    filtered,
  }
}
