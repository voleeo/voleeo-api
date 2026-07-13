import { useMemo, useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { ResponseHeader } from "@/components/ResponseHeader"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { type SseFrame, useSseStore } from "@/store/sse"
import { useUiStore } from "@/store/workspace"
import { analyzeBody, BodyTab } from "./BodyTab"
import { isHtmlResponse, isSseResponse } from "./bodyLang"
import { CookiesTab, collectReceivedRows } from "./CookiesTab"
import { HeadersTab } from "./HeadersTab"
import { HistoryPicker } from "./HistoryPicker"
import type { HtmlView } from "./HtmlBody"
import { ResponseLoading } from "./ResponseLoading"
import { ResponseStatusLine } from "./ResponseStatusLine"
import { ResponseTabBar, type TabId } from "./ResponseTabBar"
import {
  codeBodyFlags,
  EMPTY_ROWS,
  ERROR_BANNER,
  useLiveSseResponse,
} from "./responsePaneHelpers"
import { SaveSnapshotButton } from "./SaveSnapshotButton"
import { SseStreamTab } from "./SseStreamTab"
import { SseFilterPane } from "./SseStreamTab/SseFilterPane"
import { SseRawView } from "./SseStreamTab/SseRawView"
import { useSseView } from "./SseStreamTab/useSseView"
import { TimelineTab } from "./TimelineTab"
import { useCodeTools } from "./useCodeTools"
import { useHistorySync } from "./useHistorySync"

const NO_FRAMES: never[] = []
const NO_EVENTS: never[] = []

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
    historyLoading,
    historyChecking,
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
  const isLive = loading && !historicalResponse

  const liveFrames = useSseStore((s) =>
    activeRequestId ? (s.frames[activeRequestId] ?? NO_FRAMES) : NO_FRAMES,
  )

  const sseFrames: SseFrame[] = historicalResponse
    ? (historicalResponse.sseFrames ?? NO_FRAMES)
    : liveFrames.length > 0
      ? liveFrames
      : (liveResponse?.sseFrames ?? NO_FRAMES)

  const isSse =
    sseFrames.length > 0 ||
    isSseResponse(response ?? null) ||
    (isLive && liveFrames.length > 0)
  const sseView = useSseView(sseFrames, activeRequestId ?? null)

  const liveTimingMs =
    isLive && liveFrames.length > 0
      ? liveFrames[liveFrames.length - 1].atMs
      : null
  const timingMs = liveTimingMs ?? response?.timing?.totalMs ?? null

  const liveTimeline = useSseStore((s) =>
    activeRequestId ? s.timeline[activeRequestId] : undefined,
  )
  const sseOpen = useSseStore((s) =>
    activeRequestId ? s.open[activeRequestId] : undefined,
  )
  const liveBytes = useSseStore((s) =>
    activeRequestId ? (s.bytes[activeRequestId] ?? 0) : 0,
  )
  const liveHeader = isLive ? sseOpen : undefined
  const timelineEvents = isLive
    ? (liveTimeline ?? NO_EVENTS)
    : (response?.events ?? NO_EVENTS)

  const streamError =
    timelineEvents.find((e) => e.kind === "error")?.text ?? null

  const liveSseResponse = useLiveSseResponse(
    isLive,
    activeRequestId ?? null,
    sseOpen,
    liveBytes,
    liveTimingMs ?? 0,
    timelineEvents,
  )

  const tabResponse = isLive ? (liveSseResponse ?? null) : (response ?? null)

  const [tab, setTab] = useState<TabId>("body")
  const [htmlView, setHtmlView] = useState<HtmlView>("preview")
  const codeTools = useCodeTools()
  const bodyInfo = useMemo(() => analyzeBody(response ?? null), [response])

  const sseTools = isSse && tab === "body"

  const headerCount = tabResponse?.headers.length ?? 0
  const cookieCount = useMemo(
    () => (tabResponse ? collectReceivedRows(tabResponse).length : 0),
    [tabResponse],
  )

  if (activeRequestId && !response && sseFrames.length === 0) {
    if (historyLoading) return <ResponseLoading />
    if (historyChecking) return <div className="h-full" />
    if (!loading && !error) return <EmptyPaneShortcuts rows={EMPTY_ROWS} />
  }

  const isHtml = isHtmlResponse(response ?? null)
  const { isCodeBody, canFilter } = codeBodyFlags(
    response ?? null,
    isSse,
    isHtml,
    bodyInfo,
  )

  return (
    <div className="@container h-full min-h-0 flex flex-col">
      <div className="shrink-0 bg-accent/[0.035]">
        <ResponseHeader
          trailing={
            activeRequestId &&
            activeWorkspaceId && (
              <div className="flex items-center gap-1">
                <SaveSnapshotButton
                  workspaceId={activeWorkspaceId}
                  requestId={activeRequestId}
                  responseId={!isSse && !isLive ? response?.responseId : null}
                />
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
              </div>
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
          showCodeTools={tab === "body" && isCodeBody}
          canFilter={canFilter}
          codeTools={codeTools}
        />
      </div>

      {sseTools && sseView.searchOpen && <SseFilterPane view={sseView} />}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-[270px]">
        {historyLoading ? (
          <ResponseLoading />
        ) : error ? (
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
                  <SseStreamTab view={sseView} loading={isLive} />
                )
              ) : (
                <BodyTab
                  response={response ?? null}
                  loading={loading}
                  htmlView={htmlView}
                  body={bodyInfo}
                  tools={codeTools}
                />
              ))}
            {tab === "headers" && (
              <HeadersTab response={tabResponse} loading={loading} />
            )}
            {tab === "cookies" && (
              <CookiesTab response={tabResponse} loading={loading} />
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
