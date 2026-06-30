import { useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { ResponseHeader } from "@/components/ResponseHeader"
import { SHORTCUTS } from "@/config/shortcuts"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { type SseFrame, useSseStore } from "@/store/sse"
import { useUiStore } from "@/store/workspace"
import { BodyTab } from "./BodyTab"
import { isHtmlResponse, isSseResponse } from "./bodyLang"
import { CookiesTab, collectReceivedRows } from "./CookiesTab"
import { HeadersTab } from "./HeadersTab"
import { HistoryPicker } from "./HistoryPicker"
import type { HtmlView } from "./HtmlBody"
import { ResponseStatusLine } from "./ResponseStatusLine"
import { ResponseTabBar, type TabId } from "./ResponseTabBar"
import { SseStreamTab } from "./SseStreamTab"
import { SseFilterPane } from "./SseStreamTab/SseFilterPane"
import { SseRawView } from "./SseStreamTab/SseRawView"
import { useSseView } from "./SseStreamTab/useSseView"
import { TimelineTab } from "./TimelineTab"
import { useHistorySync } from "./useHistorySync"

const NO_FRAMES: never[] = []

const ERROR_BANNER =
  "rounded-[5px] border border-dashed border-destructive/45 bg-destructive/[0.04] px-3 py-2 font-mono text-[0.75rem] text-fg leading-[1.5] whitespace-pre-wrap break-all"

export function ResponsePane() {
  const activeRequestId = useRequestStore((s) => s.activeRequestId)
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const liveResponse = useHttpStore((s) =>
    activeRequestId ? s.responses[activeRequestId] : undefined,
  )
  const loading = useHttpStore((s) =>
    activeRequestId ? Boolean(s.loading[activeRequestId]) : false,
  )
  const error = useHttpStore((s) =>
    activeRequestId ? s.errors[activeRequestId] : undefined,
  )

  const {
    historyRefreshKey,
    historicalResponse,
    selectedHistoryId,
    selectedHistoryRecordedAt,
    isLatestHistory,
    handleHistorySelect,
    handleHistoryClear,
    showLive,
  } = useHistorySync({
    activeWorkspaceId,
    activeRequestId,
    liveResponse,
    loading,
  })

  const response = historicalResponse ?? liveResponse

  const liveFrames = useSseStore((s) =>
    activeRequestId ? (s.frames[activeRequestId] ?? NO_FRAMES) : NO_FRAMES,
  )

  const sseFrames: SseFrame[] = historicalResponse
    ? (historicalResponse.sseFrames ?? NO_FRAMES)
    : loading
      ? liveFrames
      : liveResponse?.sseFrames?.length
        ? liveResponse.sseFrames
        : liveFrames

  const isSse =
    sseFrames.length > 0 ||
    isSseResponse(response ?? null) ||
    (loading && liveFrames.length > 0)
  const sseView = useSseView(sseFrames, activeRequestId ?? null)

  const liveTimingMs =
    loading && !historicalResponse && liveFrames.length > 0
      ? liveFrames[liveFrames.length - 1].atMs
      : null
  const timingMs = liveTimingMs ?? response?.timing.totalMs ?? null

  const liveTimeline = useSseStore((s) =>
    activeRequestId ? s.timeline[activeRequestId] : undefined,
  )
  const sseOpen = useSseStore((s) =>
    activeRequestId ? s.open[activeRequestId] : undefined,
  )
  const liveBytes = useSseStore((s) =>
    activeRequestId ? (s.bytes[activeRequestId] ?? 0) : 0,
  )
  const liveHeader = loading && !historicalResponse ? sseOpen : undefined
  const timelineEvents =
    loading && !historicalResponse && liveTimeline?.length
      ? liveTimeline
      : (response?.events ?? [])

  const streamError =
    response?.events?.find((e) => e.kind === "error")?.text ?? null

  const [tab, setTab] = useState<TabId>("body")
  const [htmlView, setHtmlView] = useState<HtmlView>("preview")

  const sseTools = isSse && tab === "body"

  if (activeRequestId && !response && !loading && !error) {
    return (
      <EmptyPaneShortcuts
        rows={[
          { label: "Send Active Request", combo: SHORTCUTS.SEND_REQUEST },
          { label: "New Request", combo: SHORTCUTS.NEW_ITEM },
        ]}
      />
    )
  }

  const headerCount = response?.headers.length ?? 0
  const cookieCount = response ? collectReceivedRows(response).length : 0
  const isHtml = isHtmlResponse(response ?? null)

  return (
    <div className="@container h-full min-h-0 flex flex-col">
      <ResponseHeader
        trailing={
          activeRequestId &&
          activeWorkspaceId && (
            <HistoryPicker
              workspaceId={activeWorkspaceId}
              requestId={activeRequestId}
              selectedId={selectedHistoryId}
              refreshKey={historyRefreshKey}
              loading={loading}
              onSelect={handleHistorySelect}
              onShowLive={showLive}
              onClear={handleHistoryClear}
            />
          )
        }
      >
        <ResponseStatusLine
          error={error}
          loading={loading}
          liveHeader={liveHeader}
          liveTimingMs={liveTimingMs}
          liveBytes={liveBytes}
          response={response}
          historicalResponse={historicalResponse}
          isLatestHistory={isLatestHistory}
          selectedHistoryRecordedAt={selectedHistoryRecordedAt}
        />
      </ResponseHeader>

      <ResponseTabBar
        tab={tab}
        setTab={setTab}
        isSse={isSse}
        frameCount={sseFrames.length}
        headerCount={headerCount}
        cookieCount={cookieCount}
        timingMs={timingMs}
        isHtml={isHtml}
        htmlView={htmlView}
        setHtmlView={setHtmlView}
        sseTools={sseTools}
        sseView={sseView}
      />

      {sseTools && sseView.searchOpen && <SseFilterPane view={sseView} />}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {error ? (
          <div className="flex-1 overflow-y-auto px-3.5 pt-2.5">
            <div className={ERROR_BANNER}>{error}</div>
          </div>
        ) : (
          <>
            {streamError && (
              <div className="shrink-0 px-3.5 pt-2.5">
                <div className={ERROR_BANNER}>{streamError}</div>
              </div>
            )}
            {tab === "body" &&
              (isSse ? (
                sseView.raw ? (
                  <SseRawView frames={sseView.filtered} />
                ) : (
                  <SseStreamTab
                    view={sseView}
                    loading={loading && !historicalResponse}
                  />
                )
              ) : (
                <BodyTab
                  response={response ?? null}
                  loading={loading}
                  htmlView={htmlView}
                />
              ))}
            {tab === "headers" && (
              <HeadersTab response={response ?? null} loading={loading} />
            )}
            {tab === "cookies" && (
              <CookiesTab response={response ?? null} loading={loading} />
            )}
            {tab === "timeline" && (
              <TimelineTab events={timelineEvents} loading={loading} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
