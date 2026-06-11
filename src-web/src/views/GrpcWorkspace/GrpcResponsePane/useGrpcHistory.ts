import { useCallback, useEffect, useState } from "react"
import {
  commands,
  type GrpcResponse,
  type StoredGrpcSession,
} from "../../../../../packages/types/bindings"

/** Saved-history browsing for the response pane: selection state, list refresh
 * when a live result lands, and the unary latest-result preload. */
export function useGrpcHistory({
  workspaceId,
  id,
  streaming,
  status,
  liveTranscriptLength,
  liveResponse,
  error,
  clearResponse,
}: {
  workspaceId: string
  id: string
  streaming: boolean
  status: string
  liveTranscriptLength: number
  liveResponse: GrpcResponse | undefined
  error: string | undefined
  clearResponse: (id: string) => void
}) {
  const [histId, setHistId] = useState<string | null>(null)
  const [histUnary, setHistUnary] = useState<GrpcResponse | null>(null)
  const [histSession, setHistSession] = useState<StoredGrpcSession | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: id resets history view
  useEffect(() => {
    setHistId(null)
    setHistUnary(null)
    setHistSession(null)
  }, [id])

  // Re-fetch the history list whenever a fresh live result lands.
  const liveKey = streaming
    ? `${status}:${liveTranscriptLength}`
    : (liveResponse?.responseId ?? "")
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveKey is the trigger
  useEffect(() => {
    setRefreshKey((k) => k + 1)
  }, [liveKey])

  // Track saved history (so the header can hide when empty) and, for unary,
  // preload the most recent result when nothing was sent this session.
  const [hasHistory, setHasHistory] = useState(false)
  const [latestUnary, setLatestUnary] = useState<GrpcResponse | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-checks after each send
  useEffect(() => {
    if (!workspaceId || !id) return
    let alive = true
    if (streaming) {
      setLatestUnary(null)
      void commands.grpcListSessions(workspaceId, id).then((r) => {
        if (alive) setHasHistory(r.status === "ok" && r.data.length > 0)
      })
      return () => {
        alive = false
      }
    }
    void commands.grpcListUnaryResponses(workspaceId, id).then((r) => {
      if (!alive) return
      const items = r.status === "ok" ? r.data : []
      setHasHistory(items.length > 0)
      // Preload the latest only when this session has neither a live result nor
      // a live error to show (a failed call must surface the error, not history).
      if (items[0] && !liveResponse && !error) {
        void commands
          .grpcGetUnaryResponse(workspaceId, id, items[0].id)
          .then((res) => {
            if (alive && res.status === "ok") setLatestUnary(res.data)
          })
      } else {
        setLatestUnary(null)
      }
    })
    return () => {
      alive = false
    }
  }, [workspaceId, id, streaming, refreshKey, liveResponse, error])

  const onSelectHistory = useCallback(
    (selId: string, isLatest: boolean) => {
      if (isLatest) {
        setHistId(null)
        setHistUnary(null)
        setHistSession(null)
        return
      }
      setHistId(selId)
      if (streaming) {
        void commands.grpcGetSession(workspaceId, id, selId).then((r) => {
          if (r.status === "ok") setHistSession(r.data)
        })
      } else {
        void commands.grpcGetUnaryResponse(workspaceId, id, selId).then((r) => {
          if (r.status === "ok") setHistUnary(r.data)
        })
      }
    },
    [workspaceId, id, streaming],
  )

  const onClearHistory = useCallback(() => {
    setHistId(null)
    setHistUnary(null)
    setHistSession(null)
    setLatestUnary(null)
    clearResponse(id)
    setRefreshKey((k) => k + 1)
  }, [clearResponse, id])

  return {
    histId,
    histUnary,
    histSession,
    refreshKey,
    hasHistory,
    latestUnary,
    onSelectHistory,
    onClearHistory,
  }
}
