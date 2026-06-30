import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useRef } from "react"
import { ActiveIndicator } from "@/components/ActiveIndicator"
import { Dot } from "@/components/Dot"
import { cn } from "@/lib/utils"
import { useInterfaceStore } from "@/store/interface"
import { FrameRow } from "./FrameRow"
import type { SseView } from "./useSseView"

const STICK_THRESHOLD = 40

export function SseStreamTab({
  view,
  loading,
}: {
  view: SseView
  loading: boolean
}) {
  const { filter, query, open, filtered, total, toggleOne } = view

  const fontSize = useInterfaceStore((s) => s.editorFontSize)
  const rowH = Math.round(fontSize * 2.7)

  const parentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const virt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 16,
    getItemKey: (i) => filtered[i]?.seq ?? i,
  })

  // Re-measure rows when the editor font size (and thus row height) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on fontSize change
  useEffect(() => virt.measure(), [fontSize])

  const recomputeStick = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    stick.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
  }, [])

  // Follow the bottom as rows enter (new matching frame) or a row's height
  // changes (expand/collapse) — but only while the user hasn't scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered count + open set are the triggers, not read values
  useEffect(() => {
    if (!stick.current) return
    const el = parentRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [filtered.length, open])

  // Changing the filter/query relayouts the list without firing a scroll event;
  // re-derive `stick` from the new metrics so live-follow isn't left stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filter/query are the relayout triggers
  useEffect(() => {
    const id = requestAnimationFrame(recomputeStick)
    return () => cancelAnimationFrame(id)
  }, [filter, query, recomputeStick])

  const onTypeToSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (view.searchOpen) view.setSearchOpen(false)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
    const t = e.target as HTMLElement
    if (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.isContentEditable
    ) {
      return
    }
    e.preventDefault()
    view.setSearchOpen(true)
    view.setQuery(view.query + e.key)
  }

  const empty = filtered.length === 0

  return (
    <div
      className="flex-1 min-h-0 flex flex-col outline-none"
      tabIndex={0}
      onKeyDown={onTypeToSearch}
    >
      <div
        ref={parentRef}
        onScroll={recomputeStick}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {empty ? (
          <div className="flex h-full items-center justify-center text-muted/70 text-[0.85rem]">
            {total === 0
              ? loading
                ? "Waiting for events…"
                : "No stream events"
              : "No events match this filter."}
          </div>
        ) : (
          <div
            style={{
              height: virt.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virt.getVirtualItems().map((vi) => {
              const f = filtered[vi.index]
              return (
                <div
                  key={f.seq}
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
                  <FrameRow
                    frame={f}
                    open={open.has(f.seq)}
                    onToggle={toggleOne}
                    fontSize={fontSize}
                    rowH={rowH}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <StatusBar live={loading} shown={filtered.length} total={total} />
    </div>
  )
}

function StatusBar({
  live,
  shown,
  total,
}: {
  live: boolean
  shown: number
  total: number
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-2 border-t border-border shrink-0 font-mono text-[0.7rem] text-muted/70">
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          live ? "text-success" : "text-muted",
        )}
      >
        {live ? (
          <>
            <ActiveIndicator />
            Streaming
          </>
        ) : (
          <>
            <Dot color="var(--base04)" className="-mx-1" />
            closed
          </>
        )}
      </span>
      <span>text/event-stream</span>
      <span className="flex-1" />
      <span className="inline-flex items-center">
        {shown} shown
        <Dot size={13} />
        {total} total
      </span>
    </div>
  )
}
