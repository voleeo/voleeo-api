import { useCallback, useEffect, useRef, useState } from "react"
import { useUiStore } from "@/store/workspace"
import {
  type BodyMatch,
  commands,
  type HttpResponse,
  type SearchOpts,
} from "../../../../../packages/types/bindings"

// Lines are fetched a block at a time so scrolling triggers few, coarse IPC calls.
const BLOCK = 200

export interface SearchState {
  matches: BodyMatch[]
  total: number
  truncated: boolean
  /** Index into `matches`, or -1 when there are none. */
  active: number
}

const EMPTY_SEARCH: SearchState = {
  matches: [],
  total: 0,
  truncated: false,
  active: -1,
}

export interface FilterState {
  total: number
  matchCount: number
  error: string | null
}

/** Fetches a windowed response body one block at a time, runs backend search,
 *  and applies a backend JSONPath filter — the body never enters JS whole. */
export function useWindowedBody(response: HttpResponse) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const responseId = response.responseId ?? ""
  const baseTotal = response.bodyLineCount ?? 0

  // A JSONPath filter swaps the active view to a derived body key.
  const [filter, setFilter] = useState<FilterState | null>(null)
  const filtered = !!filter && !filter.error
  const activeKey = filtered ? `${responseId}.filter` : responseId
  const total = filtered ? filter.total : baseTotal

  const lines = useRef<Map<number, string>>(new Map())
  /** Line index → line its block closes on. Only block-opening lines are kept. */
  const foldEnds = useRef<Map<number, number>>(new Map())
  const loaded = useRef<Set<number>>(new Set())
  const pending = useRef<Set<number>>(new Set())
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  // Switching response or filter view invalidates every cached block.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — fires on activeKey change
  useEffect(() => {
    lines.current.clear()
    foldEnds.current.clear()
    loaded.current.clear()
    pending.current.clear()
  }, [activeKey])

  // A new response drops any active filter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — fires on responseId change
  useEffect(() => setFilter(null), [responseId])

  const ensureRange = useCallback(
    (start: number, end: number) => {
      if (!workspaceId || !activeKey) return
      for (
        let b = Math.floor(start / BLOCK);
        b <= Math.floor(end / BLOCK);
        b++
      ) {
        if (loaded.current.has(b) || pending.current.has(b)) continue
        pending.current.add(b)
        const from = b * BLOCK
        commands
          .responseBodyWindow(workspaceId, activeKey, from, BLOCK)
          .then((res) => {
            pending.current.delete(b)
            if (res.status !== "ok") return
            res.data.lines.forEach((ln, i) => {
              lines.current.set(from + i, ln)
              const end = res.data.foldEnds[i]
              if (end) foldEnds.current.set(from + i, end)
            })
            loaded.current.add(b)
            rerender()
          })
          .catch(() => pending.current.delete(b))
      }
    },
    [workspaceId, activeKey, rerender],
  )

  const getLine = useCallback((i: number) => lines.current.get(i), [])
  const getFoldEnd = useCallback((i: number) => foldEnds.current.get(i), [])

  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH)
  const runSearch = useCallback(
    async (query: string, opts: SearchOpts) => {
      if (!workspaceId || !activeKey || !query.trim()) {
        setSearch(EMPTY_SEARCH)
        return
      }
      const res = await commands.responseBodySearch(
        workspaceId,
        activeKey,
        query,
        opts,
      )
      if (res.status !== "ok") return
      setSearch({
        matches: res.data.matches,
        total: res.data.total,
        truncated: res.data.truncated,
        active: res.data.matches.length ? 0 : -1,
      })
    },
    [workspaceId, activeKey],
  )

  const stepMatch = useCallback((dir: 1 | -1) => {
    setSearch((s) =>
      s.matches.length
        ? {
            ...s,
            active: (s.active + dir + s.matches.length) % s.matches.length,
          }
        : s,
    )
  }, [])

  const applyFilter = useCallback(
    async (query: string) => {
      if (!workspaceId || !responseId) return
      if (!query.trim()) {
        setFilter(null)
        return
      }
      const res = await commands.responseBodyFilter(
        workspaceId,
        responseId,
        query,
      )
      if (res.status !== "ok") return
      setFilter({
        total: res.data.lineCount,
        matchCount: res.data.matchCount,
        error: res.data.error ?? null,
      })
    },
    [workspaceId, responseId],
  )

  return {
    /** Identifies the body being viewed — changes when the response or filter does. */
    activeKey,
    total,
    getLine,
    getFoldEnd,
    ensureRange,
    search,
    runSearch,
    stepMatch,
    filter,
    applyFilter,
  }
}
