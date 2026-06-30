import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { SentRequestSummary } from "@/views/ApiWorkspace/SentRequestInspector/SentRequestSummary"
import type { TimelineEvent } from "../../../../../../packages/types/bindings"
import { ScrollToBottomButton } from "../ScrollToBottomButton"
import { useStickToBottom } from "../useStickToBottom"
import {
  buildEntries,
  FILTER_GROUPS,
  type FilterId,
  matchesFilter,
} from "./entries"
import { TimelineRow } from "./TimelineRow"

export function TimelineTab({
  events,
  loading,
}: {
  events: TimelineEvent[]
  loading: boolean
}) {
  const [filter, setFilter] = useState<FilterId>("all")
  const [sentExpanded, setSentExpanded] = useState(false)
  const activeRequestId = useRequestStore((s) => s.activeRequestId)
  const lastSent = useHttpStore((s) =>
    activeRequestId ? s.lastSent[activeRequestId] : undefined,
  )

  const entries = useMemo(() => buildEntries(events), [events])

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

  // Virtualized so an SSE response with thousands of per-frame rows stays smooth.
  const { parentRef, stick, atBottom, recomputeStick, scrollToBottom } =
    useStickToBottom()

  const virt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20,
  })

  // A filter relayout (and first mount) fires no scroll event — re-derive
  // stick/atBottom so the button shows even at the top of a finished run. New
  // rows don't need it (live-follow's scroll fires onScroll; a scrolled-up list
  // keeps the button shown).
  // biome-ignore lint/correctness/useExhaustiveDependencies: relayout triggers, not read values
  useEffect(() => {
    const id = requestAnimationFrame(recomputeStick)
    return () => cancelAnimationFrame(id)
  }, [filter, recomputeStick])

  // While streaming, follow the newest timeline row as rows arrive, but pause the moment the user scrolls up. Mirrors the SSE frame list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: row count is the trigger, not a read value
  useEffect(() => {
    if (!loading || !stick.current) return
    const el = parentRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [filtered.length, loading])

  if (loading && entries.length === 0) {
    return (
      <div className="px-3.5 py-6 flex flex-col items-center gap-3 text-muted">
        <Spinner className="size-5 text-fg" aria-hidden />
        <span className="font-mono text-[0.786rem]">
          Waiting for response...
        </span>
      </div>
    )
  }

  if (entries.length === 0) {
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
      <div className="relative flex-1 min-h-0">
        <div
          ref={parentRef}
          onScroll={recomputeStick}
          className="h-full overflow-auto font-mono text-[0.786rem] leading-[1.7]"
        >
          {filtered.length === 0 ? (
            <div className="px-3.5 py-3 text-muted">
              No events match this filter.
            </div>
          ) : (
            <div
              style={{
                height: virt.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virt.getVirtualItems().map((vi) => (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virt.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <TimelineRow
                    entry={filtered[vi.index]}
                    prevElapsed={
                      vi.index > 0 ? filtered[vi.index - 1].elapsedMs : null
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        {!atBottom && filtered.length > 0 && (
          <ScrollToBottomButton onClick={scrollToBottom} />
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
