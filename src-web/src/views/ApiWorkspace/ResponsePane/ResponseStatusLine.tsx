import { Dot } from "@/components/Dot"
import { HistoryTag, StatusPill } from "@/components/ResponseHeader"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { SseOpen } from "@/store/sse"
import type { HttpResponse } from "../../../../../packages/types/bindings"
import { formatBytes, formatDuration } from "./format"
import { RedirectWarningBadge } from "./RedirectWarningBadge"

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

function StatusAndStats({
  status,
  statusText,
  durationMs,
  bytes,
}: {
  status: number
  statusText: string
  durationMs: number
  bytes: number
}) {
  const c = statusColor(status)
  return (
    <>
      <StatusPill className={cn(c.className, c.textClass)}>
        {status} {statusText || "—"}
      </StatusPill>
      <div className="flex items-center font-mono text-[0.75rem] text-muted min-w-0">
        <span>{formatDuration(durationMs)}</span>
        <Dot size={13} />
        <span>{formatBytes(bytes)}</span>
      </div>
    </>
  )
}

interface Props {
  error: string | undefined
  loading: boolean
  liveHeader: SseOpen | undefined
  liveTimingMs: number | null
  liveBytes: number
  response: HttpResponse | undefined
  historicalResponse: HttpResponse | null
  isLatestHistory: boolean
  selectedHistoryRecordedAt: string | null
}

export function ResponseStatusLine({
  error,
  loading,
  liveHeader,
  liveTimingMs,
  liveBytes,
  response,
  historicalResponse,
  isLatestHistory,
  selectedHistoryRecordedAt,
}: Props) {
  if (error) {
    return (
      <>
        <StatusPill className="border-destructive text-destructive">
          ERROR
        </StatusPill>
        <div className="flex items-center font-mono text-[0.75rem] text-muted">
          — ms
          <Dot size={13} />— B
        </div>
      </>
    )
  }

  if (loading) {
    return (
      <>
        <Spinner className="size-3.5 text-fg shrink-0" aria-label="Loading" />
        {liveHeader ? (
          <StatusAndStats
            status={liveHeader.status}
            statusText={liveHeader.statusText}
            durationMs={liveTimingMs ?? 0}
            bytes={liveBytes}
          />
        ) : (
          <div className="font-mono text-[0.75rem] text-muted">Sending...</div>
        )}
      </>
    )
  }

  if (response) {
    const stale =
      historicalResponse &&
      (!isLatestHistory ||
        (selectedHistoryRecordedAt &&
          Date.now() - new Date(selectedHistoryRecordedAt).getTime() >
            5 * 60_000))
    return (
      <>
        {stale && <HistoryTag />}
        <StatusAndStats
          status={response.status}
          statusText={response.statusText}
          durationMs={response.timing.totalMs ?? 0}
          bytes={response.bodySize}
        />
        {response.redirectWarning && (
          <RedirectWarningBadge info={response.redirectWarning} />
        )}
      </>
    )
  }

  return (
    <div className="font-mono text-[0.75rem] text-muted">
      Send a request to see the response
    </div>
  )
}
