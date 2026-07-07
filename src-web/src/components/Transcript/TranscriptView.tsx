import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useMemo } from "react"
import { CodeView } from "@/components/CodeView"
import { Glyph } from "@/components/Glyph"
import { useInterfaceStore } from "@/store/interface"
import { ScrollToBottomButton } from "@/views/ApiWorkspace/ResponsePane/ScrollToBottomButton"
import {
  useFollowTail,
  useStickToBottom,
} from "@/views/ApiWorkspace/ResponsePane/useStickToBottom"
import { commentLines } from "./commentLines"
import { prettyJson, rawMessageHeader } from "./format"
import { TranscriptRow } from "./TranscriptRow"
import type { TranscriptMessage } from "./types"
import type { TranscriptViewState } from "./useTranscriptView"

export function TranscriptView<T extends TranscriptMessage>({
  view,
  live,
  emptyLabel = "No messages yet.",
}: {
  view: TranscriptViewState<T>
  live: boolean
  emptyLabel?: string
}) {
  const {
    filtered,
    isOpen,
    toggleOne,
    query,
    setQuery,
    searchOpen,
    closeSearch,
    foldSignal,
    raw,
  } = view

  const rawText = useMemo(
    () =>
      filtered
        .map((m, i) => `${rawMessageHeader(m, i)}\n${prettyJson(m.data)}`)
        .join("\n\n"),
    [filtered],
  )

  const fontSize = useInterfaceStore((s) => s.editorFontSize)
  const rowH = Math.round(fontSize * 2.7)

  const {
    parentRef,
    stick,
    atBottom,
    pin,
    recomputeStick,
    onWheel,
    onPointerDown,
    onKeyDown,
    scrollToBottom,
  } = useStickToBottom()

  const virt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 16,
  })
  const totalSize = virt.getTotalSize()

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on fontSize change
  useEffect(() => virt.measure(), [fontSize])

  // Re-pin on real content change (newest id + an expand), never on measurement
  // jitter; gated on `live` so a finished transcript never yanks the scroll.
  const lastId = filtered.length > 0 ? filtered[filtered.length - 1].id : ""
  useFollowTail(pin, stick, `${lastId}:${foldSignal}`, live)

  // Filter relayout fires no scroll event — re-derive stick/atBottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: relayout trigger, not read value
  useEffect(() => {
    const id = requestAnimationFrame(recomputeStick)
    return () => cancelAnimationFrame(id)
  }, [query, recomputeStick])

  const empty = filtered.length === 0
  const emptyText = query.trim()
    ? "No messages match this filter."
    : live
      ? "Waiting for messages…"
      : emptyLabel

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface">
          <Glyph kind="search" size={12} color="var(--base04)" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeSearch()}
            placeholder="Filter messages"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-none outline-none font-mono text-[0.786rem] text-fg placeholder:text-muted"
          />
          {query.trim() && (
            <span className="font-mono text-[0.714rem] text-muted shrink-0">
              {filtered.length} match{filtered.length !== 1 ? "es" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={closeSearch}
            className="flex items-center justify-center w-4 h-4 rounded-[2px] border-0 bg-transparent outline-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
          >
            <Glyph kind="x" size={10} color="var(--base04)" />
          </button>
        </div>
      )}

      {empty ? (
        <div className="flex flex-1 min-h-0 items-center justify-center text-muted/70 text-[0.85rem]">
          {emptyText}
        </div>
      ) : raw ? (
        <div className="flex-1 min-h-0">
          <CodeView
            value={rawText}
            lang="json"
            lineNumbers
            wrap={false}
            height="100%"
            extraExtensions={commentLines}
          />
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
          <div
            ref={parentRef}
            onScroll={recomputeStick}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className="h-full overflow-y-auto"
          >
            <div
              style={{ height: totalSize, position: "relative", width: "100%" }}
            >
              {virt.getVirtualItems().map((vi) => {
                const m = filtered[vi.index]
                return (
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
                    <TranscriptRow
                      message={m}
                      open={isOpen(m.id)}
                      onToggle={toggleOne}
                      fontSize={fontSize}
                      rowH={rowH}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          {!atBottom && <ScrollToBottomButton onClick={scrollToBottom} />}
        </div>
      )}
    </div>
  )
}
