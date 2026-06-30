import { emit, listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useState } from "react"
import { EVENTS } from "@/config/events"
import { useHttpStore } from "@/store/http"
import type { HttpResponse } from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"

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

  const resetSelection = useCallback(() => {
    setHistoricalResponse(null)
    setSelectedHistoryId(null)
    setSelectedHistoryRecordedAt(null)
    setIsLatestHistory(false)
  }, [])

  useEffect(() => {
    resetSelection()
    if (!activeWorkspaceId || !activeRequestId) return
    if (useHttpStore.getState().responses[activeRequestId]) return
    if (useHttpStore.getState().loading[activeRequestId]) return

    let cancelled = false
    commands.responseList(activeWorkspaceId, activeRequestId).then((res) => {
      if (cancelled || res.status !== "ok" || res.data.length === 0) return
      const latest = res.data[0]
      commands
        .responseGet(activeWorkspaceId, activeRequestId, latest.id)
        .then((res2) => {
          if (cancelled || res2.status !== "ok" || !res2.data) return
          setHistoricalResponse(res2.data.response)
          setSelectedHistoryId(latest.id)
          setSelectedHistoryRecordedAt(res2.data.recordedAt)
          setIsLatestHistory(true)
        })
    })
    return () => {
      cancelled = true
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
      const res = await commands.responseGet(
        activeWorkspaceId,
        activeRequestId,
        responseId,
      )
      if (res.status === "ok" && res.data) {
        setHistoricalResponse(res.data.response)
        setSelectedHistoryId(responseId)
        setSelectedHistoryRecordedAt(res.data.recordedAt)
        setIsLatestHistory(isLatest)
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
    handleHistorySelect,
    handleHistoryClear,
    showLive: resetSelection,
  }
}
