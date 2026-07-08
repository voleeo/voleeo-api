import { useEffect, useState } from "react"
import { useWebsocketStore } from "@/store/websocket"
import type { StoredWsSession } from "../../../../../packages/types/bindings"

/** Owns historical-session selection/loading for the transcript pane: the
 *  explicitly-picked session, a refresh counter to re-trigger the picker's
 *  list, and a "most recent session" preload for an idle connection with no
 *  live transcript. */
export function useHistoricalSession(
  workspaceId: string,
  id: string | undefined,
  status: string,
  liveMessageCount: number,
) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [historical, setHistorical] = useState<StoredWsSession | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (status === "connecting" || status === "open") {
      setSelectedSessionId(null)
      setHistorical(null)
    }
    setRefreshKey((k) => k + 1)
  }, [status])

  const getSession = useWebsocketStore((s) => s.getSession)
  const listSessions = useWebsocketStore((s) => s.listSessions)
  useEffect(() => {
    if (!id || !selectedSessionId) {
      setHistorical(null)
      return
    }
    let cancelled = false
    getSession(workspaceId, id, selectedSessionId).then((data) => {
      if (!cancelled) setHistorical(data)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId, id, selectedSessionId, getSession])

  const live =
    status === "open" || status === "connecting" || status === "closing"

  // With no live transcript and nothing explicitly selected, preload the most
  // recent session so an idle connection still shows its last result.
  const [latest, setLatest] = useState<StoredWsSession | null>(null)
  useEffect(() => {
    if (!id || live || liveMessageCount > 0 || selectedSessionId) {
      setLatest(null)
      return
    }
    let cancelled = false
    void listSessions(workspaceId, id).then((items) => {
      if (cancelled) return
      const first = items[0]
      if (!first) return setLatest(null)
      void getSession(workspaceId, id, first.id).then((data) => {
        if (!cancelled) setLatest(data)
      })
    })
    return () => {
      cancelled = true
    }
  }, [
    workspaceId,
    id,
    live,
    liveMessageCount,
    selectedSessionId,
    listSessions,
    getSession,
  ])

  return {
    selectedSessionId,
    setSelectedSessionId,
    historical,
    refreshKey,
    live,
    latest,
  }
}
