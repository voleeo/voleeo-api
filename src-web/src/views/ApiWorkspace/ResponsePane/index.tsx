import { useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { TabItem } from "@/components/Primitives"
import {
  HistoryTag,
  ResponseHeader,
  StatusPill,
} from "@/components/ResponseHeader"
import { Spinner } from "@/components/ui/spinner"
import { SHORTCUTS } from "@/config/shortcuts"
import { cn } from "@/lib/utils"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { BodyTab } from "./BodyTab"
import { isHtmlResponse } from "./bodyLang"
import { CookiesTab, collectReceivedRows } from "./CookiesTab"
import { formatBytes, formatDuration } from "./format"
import { HeadersTab } from "./HeadersTab"
import { HistoryPicker } from "./HistoryPicker"
import type { HtmlView } from "./HtmlBody"
import { RedirectWarningBadge } from "./RedirectWarningBadge"
import { TimelineTab } from "./TimelineTab"
import { useHistorySync } from "./useHistorySync"

type TabId = "body" | "headers" | "cookies" | "timeline"

function statusColor(status: number): { className: string; textClass: string } {
  if (status < 300)
    return { className: "border-success bg-surface", textClass: "text-success" }
  if (status < 400)
    return {
      className: "border-amber-500/80 bg-surface",
      textClass: "text-amber-500",
    }
  if (status < 500)
    return {
      className: "border-amber-500/60 bg-surface",
      textClass: "text-amber-500",
    }
  return {
    className: "border-destructive bg-surface",
    textClass: "text-destructive",
  }
}

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
  } = useHistorySync({ activeWorkspaceId, activeRequestId, liveResponse })

  const response = historicalResponse ?? liveResponse

  const [tab, setTab] = useState<TabId>("body")
  const [htmlView, setHtmlView] = useState<HtmlView>("preview")

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
    <div className="h-full min-h-0 flex flex-col">
      <ResponseHeader
        trailing={
          activeRequestId &&
          activeWorkspaceId && (
            <HistoryPicker
              workspaceId={activeWorkspaceId}
              requestId={activeRequestId}
              selectedId={selectedHistoryId}
              refreshKey={historyRefreshKey}
              onSelect={handleHistorySelect}
              onClear={handleHistoryClear}
            />
          )
        }
      >
        {error ? (
          <>
            <StatusPill className="border-destructive text-destructive">
              ERROR
            </StatusPill>
            <div className="font-mono text-[0.75rem] text-muted">
              — ms · — B
            </div>
          </>
        ) : loading ? (
          <>
            <Spinner
              className="size-3.5 text-fg shrink-0"
              aria-label="Loading"
            />
            <div className="font-mono text-[0.75rem] text-muted">
              Sending...
            </div>
          </>
        ) : response ? (
          <>
            {historicalResponse &&
              (!isLatestHistory ||
                (selectedHistoryRecordedAt &&
                  Date.now() - new Date(selectedHistoryRecordedAt).getTime() >
                    5 * 60_000)) && <HistoryTag />}
            {(() => {
              const c = statusColor(response.status)
              return (
                <StatusPill className={cn(c.className, c.textClass)}>
                  {response.status} {response.statusText || "—"}
                </StatusPill>
              )
            })()}
            <div className="font-mono text-[0.75rem] text-muted min-w-0">
              <span>{formatDuration(response.timing.totalMs ?? 0)}</span> ·{" "}
              <span>{formatBytes(response.bodySize)}</span>
            </div>
            {response.redirectWarning && (
              <RedirectWarningBadge info={response.redirectWarning} />
            )}
          </>
        ) : (
          <div className="font-mono text-[0.75rem] text-muted">
            Send a request to see the response
          </div>
        )}
      </ResponseHeader>

      <div className="pt-1.5 px-3.5 border-b border-border flex">
        <TabItem
          label="RESPONSE"
          active={tab === "body"}
          onClick={() => setTab("body")}
        />
        <TabItem
          label={
            headerCount > 0 ? (
              <>
                HEADERS{" "}
                <span className="font-normal opacity-40 tracking-normal">
                  {headerCount}
                </span>
              </>
            ) : (
              "HEADERS"
            )
          }
          active={tab === "headers"}
          onClick={() => setTab("headers")}
        />
        <TabItem
          label={
            cookieCount > 0 ? (
              <>
                COOKIES{" "}
                <span className="font-normal opacity-40 tracking-normal">
                  {cookieCount}
                </span>
              </>
            ) : (
              "COOKIES"
            )
          }
          active={tab === "cookies"}
          onClick={() => setTab("cookies")}
        />
        <TabItem
          label={
            response ? (
              <>
                TIMING{" "}
                <span className="font-normal opacity-40 tracking-normal">
                  {formatDuration(response.timing.totalMs ?? 0)}
                </span>
              </>
            ) : (
              "TIMING"
            )
          }
          active={tab === "timeline"}
          onClick={() => setTab("timeline")}
        />
        {tab === "body" && isHtml && (
          <div className="ml-auto flex items-center gap-0.5 pr-0.5">
            {(["preview", "raw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setHtmlView(m)}
                style={{ fontSize: "0.714rem" }}
                className={cn(
                  "px-2 py-0.5 uppercase tracking-[0.3px] rounded-[3px] cursor-pointer transition-colors",
                  htmlView === m
                    ? "text-accent bg-accent/10"
                    : "text-muted hover:text-fg",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {error ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="rounded-[5px] border border-destructive/40 bg-destructive/[0.04] p-3.5 font-mono text-[0.786rem] text-fg leading-[1.6] whitespace-pre-wrap break-all">
              {error}
            </div>
          </div>
        ) : (
          <>
            {tab === "body" && (
              <BodyTab
                response={response ?? null}
                loading={loading}
                htmlView={htmlView}
              />
            )}
            {tab === "headers" && (
              <HeadersTab response={response ?? null} loading={loading} />
            )}
            {tab === "cookies" && (
              <CookiesTab response={response ?? null} loading={loading} />
            )}
            {tab === "timeline" && (
              <TimelineTab response={response ?? null} loading={loading} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
