import { emit, listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { EVENTS } from "@/config/events"
import { useHttpStore } from "@/store/http"
import type { HttpResponse } from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"

const SPINNER_DELAY_MS = 150

interface Options {
  activeWorkspaceId: string | null
  activeRequestId: string | null
  liveResponse: HttpResponse | undefined
  loading: boolean
}

export interface HistoryState {
  historyRefreshKey: number
  historicalResponse: HttpResponse | null
  selectedHistoryId: string | null
  selectedHistoryRecordedAt: string | null
  isLatestHistory: boolean
  historyLoading: boolean
  historyChecking: boolean
  handleHistorySelect: (responseId: string, isLatest: boolean) => Promise<void>
  handleHistoryClear: () => void
  showLive: () => void
}

export function useHistorySync({
  activeWorkspaceId,
  activeRequestId,
  liveResponse,
  loading,
}: Options): HistoryState {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [historicalResponse, setHistoricalResponse] =
    useState<HttpResponse | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null,
  )
  const [selectedHistoryRecordedAt, setSelectedHistoryRecordedAt] = useState<
    string | null
  >(null)
  const [isLatestHistory, setIsLatestHistory] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyChecking, setHistoryChecking] = useState(false)
  // Guards async resolves against a request/workspace switch mid-fetch.
  const activeRef = useRef({ ws: activeWorkspaceId, req: activeRequestId })
  activeRef.current = { ws: activeWorkspaceId, req: activeRequestId }

  const resetSelection = useCallback(() => {
    setHistoricalResponse(null)
    setSelectedHistoryId(null)
    setSelectedHistoryRecordedAt(null)
    setIsLatestHistory(false)
    setHistoryLoading(false)
    setHistoryChecking(false)
  }, [])

  useEffect(() => {
    resetSelection()
    if (!activeWorkspaceId || !activeRequestId) return
    if (useHttpStore.getState().responses[activeRequestId]) return
    if (useHttpStore.getState().loading[activeRequestId]) return

    let cancelled = false
    setHistoryChecking(true)
    const spinnerTimer = setTimeout(() => {
      if (!cancelled) setHistoryLoading(true)
    }, SPINNER_DELAY_MS)
    void (async () => {
      try {
        const res = await commands.responseList(
          activeWorkspaceId,
          activeRequestId,
        )
        if (cancelled || res.status !== "ok" || res.data.length === 0) return
        const latest = res.data[0]
        const res2 = await commands.responseGet(
          activeWorkspaceId,
          activeRequestId,
          latest.id,
        )
        if (cancelled) return
        if (res2.status === "ok" && res2.data) {
          setHistoricalResponse(res2.data.response)
          setSelectedHistoryId(latest.id)
          setSelectedHistoryRecordedAt(res2.data.recordedAt)
          setIsLatestHistory(true)
        }
      } finally {
        clearTimeout(spinnerTimer)
        if (!cancelled) {
          setHistoryLoading(false)
          setHistoryChecking(false)
        }
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(spinnerTimer)
    }
  }, [activeRequestId, activeWorkspaceId, resetSelection])

  // Clear historical view when a new live response arrives and bump the
  // refresh key so HistoryPicker re-fetches its list.
  useEffect(() => {
    if (liveResponse) {
      resetSelection()
      setHistoryRefreshKey((k) => k + 1)
    }
  }, [liveResponse, resetSelection])

  // A send starting (or landing on an already-streaming request) snaps to the
  // live/active response — the user can still pick a historical one afterward.
  useEffect(() => {
    if (loading) resetSelection()
  }, [loading, resetSelection])

  // When the MCP bridge or a pre-flight send stores a response for the active
  // request, refresh history and display the new response.
  useEffect(() => {
    if (!activeWorkspaceId || !activeRequestId) return
    let unlistenFn: (() => void) | null = null
    let unlistenFn2: (() => void) | null = null
    let unmounted = false

    const handleStored = ({
      payload,
    }: {
      payload: { workspaceId: string; requestId: string }
    }) => {
      if (unmounted) return
      if (
        payload.workspaceId !== activeWorkspaceId ||
        payload.requestId !== activeRequestId
      )
        return
      setHistoryRefreshKey((k) => k + 1)
      commands.responseList(activeWorkspaceId, activeRequestId).then((res) => {
        if (unmounted || res.status !== "ok" || res.data.length === 0) return
        commands
          .responseGet(activeWorkspaceId, activeRequestId, res.data[0].id)
          .then((res2) => {
            if (unmounted || res2.status !== "ok" || !res2.data) return
            setHistoricalResponse(res2.data.response)
            setSelectedHistoryId(res.data[0].id)
            setSelectedHistoryRecordedAt(res2.data.recordedAt)
            setIsLatestHistory(true)
          })
      })
    }

    listen<{ workspaceId: string; requestId: string }>(
      EVENTS.mcpResponseStored,
      handleStored,
    ).then((fn) => {
      if (unmounted) fn()
      else unlistenFn = fn
    })
    listen<{ workspaceId: string; requestId: string }>(
      EVENTS.responseStored,
      handleStored,
    ).then((fn) => {
      if (unmounted) fn()
      else unlistenFn2 = fn
    })

    return () => {
      unmounted = true
      unlistenFn?.()
      unlistenFn2?.()
    }
  }, [activeWorkspaceId, activeRequestId])

  const handleHistorySelect = useCallback(
    async (responseId: string, isLatest: boolean) => {
      if (!activeWorkspaceId || !activeRequestId) return
      const spinnerTimer = setTimeout(
        () => setHistoryLoading(true),
        SPINNER_DELAY_MS,
      )
      try {
        const res = await commands.responseGet(
          activeWorkspaceId,
          activeRequestId,
          responseId,
        )
        if (
          activeRef.current.ws !== activeWorkspaceId ||
          activeRef.current.req !== activeRequestId
        )
          return

        if (res.status === "ok" && res.data) {
          setHistoricalResponse(res.data.response)
          setSelectedHistoryId(responseId)
          setSelectedHistoryRecordedAt(res.data.recordedAt)
          setIsLatestHistory(isLatest)
        }
      } finally {
        clearTimeout(spinnerTimer)
        setHistoryLoading(false)
      }
    },
    [activeWorkspaceId, activeRequestId],
  )

  const handleHistoryClear = useCallback(() => {
    resetSelection()
    if (activeRequestId) {
      useHttpStore.getState().clearResponse(activeRequestId)
      emit(EVENTS.responseCleared, {
        workspaceId: activeWorkspaceId,
        requestId: activeRequestId,
      })
    }
  }, [activeWorkspaceId, activeRequestId, resetSelection])

  return {
    historyRefreshKey,
    historicalResponse,
    selectedHistoryId,
    selectedHistoryRecordedAt,
    isLatestHistory,
    historyLoading,
    historyChecking,
    handleHistorySelect,
    handleHistoryClear,
    showLive: resetSelection,
  }
}
