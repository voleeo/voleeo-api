import { useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { SentRequestSummary } from "@/views/ApiWorkspace/SentRequestInspector/SentRequestSummary"
import type { HttpResponse } from "../../../../../../packages/types/bindings"
import {
  buildEntries,
  type Entry,
  FILTER_GROUPS,
  type FilterId,
  fmtElapsed,
  GAP_MIN_MS,
  GAP_SLOW_MS,
  matchesFilter,
  PREFIX,
  TEXT_COLOR,
} from "./entries"

export function TimelineTab({
  response,
  loading,
}: {
  response: HttpResponse | null
  loading: boolean
}) {
  const [filter, setFilter] = useState<FilterId>("all")
  const [sentExpanded, setSentExpanded] = useState(false)
  const activeRequestId = useRequestStore((s) => s.activeRequestId)
  const lastSent = useHttpStore((s) =>
    activeRequestId ? s.lastSent[activeRequestId] : undefined,
  )

  const entries = useMemo(
    () => (response ? buildEntries(response) : []),
    [response],
  )

  // Compute counts per filter group so the pill labels show how much they hide.
  const counts = useMemo(() => {
    const c: Record<FilterId, number> = {
      all: entries.length,
      sent: 0,
      received: 0,
      body: 0,
      errors: 0,
    }
    for (const e of entries) {
      if (matchesFilter(e.kind, "sent")) c.sent++
      if (matchesFilter(e.kind, "received")) c.received++
      if (matchesFilter(e.kind, "body")) c.body++
      if (matchesFilter(e.kind, "errors")) c.errors++
    }
    return c
  }, [entries])

  const filtered = useMemo(
    () =>
      filter === "all"
        ? entries
        : entries.filter((e) => matchesFilter(e.kind, filter)),
    [entries, filter],
  )

  if (loading && !response) {
    return (
      <div className="px-3.5 py-6 flex flex-col items-center gap-3 text-muted">
        <Spinner className="size-5 text-fg" aria-hidden />
        <span className="font-mono text-[0.786rem]">
          Waiting for response...
        </span>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="px-3.5 py-3 text-xs text-muted font-sans">
        Send a request to see the response
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {lastSent && (
        <div className="border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setSentExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-subtle cursor-pointer bg-transparent border-0 outline-none text-left"
          >
            <span
              className="inline-flex w-[12px] shrink-0 transition-transform duration-100"
              style={{
                transform: sentExpanded ? "rotate(90deg)" : "none",
              }}
            >
              <Glyph kind="chevron" size={11} color="var(--base04)" />
            </span>
            <span className="font-mono text-[0.714rem] uppercase tracking-wide text-muted shrink-0">
              Sent
            </span>
            <span
              className="font-mono text-[0.786rem] text-fg truncate"
              title={`${lastSent.method} ${lastSent.fullUrl}`}
            >
              {lastSent.method} {lastSent.fullUrl}
            </span>
          </button>
          {sentExpanded && (
            <div className="border-t border-border max-h-[40vh] overflow-y-auto">
              <SentRequestSummary snapshot={lastSent} />
            </div>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[0.786rem] leading-[1.7] py-2">
        {filtered.length === 0 ? (
          <div className="px-3.5 py-3 text-muted">
            No events match this filter.
          </div>
        ) : (
          filtered.map((entry, i) => (
            <TimelineRow
              // biome-ignore lint/suspicious/noArrayIndexKey: order is stable per filtered slice
              key={i}
              entry={entry}
              prevElapsed={i > 0 ? filtered[i - 1].elapsedMs : null}
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border font-mono text-[0.786rem]">
        {(Object.keys(FILTER_GROUPS) as FilterId[]).map((id) => {
          const active = filter === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "px-2 py-0.5 rounded-sm transition-colors cursor-pointer",
                active
                  ? "bg-subtle text-fg"
                  : "text-muted hover:text-fg hover:bg-subtle/50",
              )}
            >
              <span className="capitalize">{id}</span>
              <span className="ml-1 opacity-60">{counts[id]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface LinkedText {
  before: string
  name: string
  after: string
}

// Parse "Called from: <name>" or "Pre-flight: <name> → ..." into segments.
function parseLinkedText(text: string): LinkedText | null {
  const calledFrom = text.match(/^(Called from: )(.+)$/)
  if (calledFrom)
    return { before: calledFrom[1], name: calledFrom[2], after: "" }
  const preflight = text.match(/^(Pre-flight: )(.+?)( →.*)$/)
  if (preflight)
    return { before: preflight[1], name: preflight[2], after: preflight[3] }
  return null
}

function TimelineRow({
  entry,
  prevElapsed,
}: {
  entry: Entry
  prevElapsed: number | null
}) {
  const gapMs = prevElapsed !== null ? entry.elapsedMs - prevElapsed : 0
  const showGap = prevElapsed !== null && gapMs >= GAP_MIN_MS
  const gapColor = gapMs >= GAP_SLOW_MS ? "var(--base0A)" : "var(--base04)"
  const color = TEXT_COLOR[entry.kind]

  const linked =
    entry.kind === "info" || entry.kind === "resolve"
      ? parseLinkedText(entry.text)
      : null

  function navigateTo(name: string) {
    const { requests, setActiveRequest } = useRequestStore.getState()
    const req = requests.find((r) => r.name === name)
    if (req) setActiveRequest(req.id)
  }

  return (
    <div className="flex items-baseline gap-0 hover:bg-subtle px-2">
      <span
        className="shrink-0 text-right pr-3 tabular-nums"
        style={{ color: "var(--base04)", minWidth: "92px" }}
      >
        {fmtElapsed(entry.elapsedMs)}
      </span>

      <span className="shrink-0 pr-2 font-bold select-none" style={{ color }}>
        {PREFIX[entry.kind]}
      </span>

      <span className="break-all" style={{ color }}>
        {linked ? (
          <>
            {linked.before}
            <button
              type="button"
              onClick={() => navigateTo(linked.name)}
              className="underline underline-offset-2 cursor-pointer bg-transparent border-0 outline-none p-0 font-mono text-[0.786rem] hover:opacity-70 transition-opacity"
              style={{ color: "var(--base0D)" }}
              title={`Navigate to "${linked.name}"`}
            >
              {linked.name}
            </button>
            {linked.after}
          </>
        ) : (
          entry.text
        )}
      </span>

      {showGap && (
        <span
          className="shrink-0 ml-auto pl-3 tabular-nums opacity-80"
          style={{ color: gapColor }}
          title="Time since previous visible row"
        >
          +{fmtElapsed(gapMs)}
        </span>
      )}
    </div>
  )
}
