import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useInterfaceStore } from "@/store/interface"
import type { HttpResponse } from "../../../../../packages/types/bindings"
import { FindBar } from "./FindBar"
import { useLineFolds } from "./useLineFolds"
import { useWindowedBody } from "./useWindowedBody"
import { VirtualBodyLines } from "./VirtualBodyLines"

// CodeMirror's effective line-height ≈ 1.5× its font size; match it so the
// virtual rows and the editor look consistent at any font setting.
const LINE_RATIO = 1.5

function isJsonResponse(response: HttpResponse): boolean {
  const ct = response.headers.find(
    (h) => h.name.toLowerCase() === "content-type",
  )?.value
  return !!ct && /json/i.test(ct)
}

/** Virtualized viewer for large (windowed) response bodies: renders only the
 *  visible lines, fetches them on demand, and searches backend-side. */
export function VirtualBody({ response }: { response: HttpResponse }) {
  const {
    activeKey,
    total,
    getLine,
    getFoldEnd,
    ensureRange,
    search,
    runSearch,
    stepMatch,
    filter,
    applyFilter,
  } = useWindowedBody(response)
  const { collapsed, visibleCount, toReal, toVisual, toggle, reveal } =
    useLineFolds(total, getFoldEnd, activeKey)
  const parentRef = useRef<HTMLDivElement>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState("")
  const json = isJsonResponse(response)

  // Track the editor font setting so the viewer scales like the CodeMirror one.
  const fontSize = useInterfaceStore((s) => s.editorFontSize)
  const lineH = Math.round(fontSize * LINE_RATIO)

  const virt = useVirtualizer({
    count: visibleCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => lineH,
    overscan: 30,
  })
  const items = virt.getVirtualItems()

  // Keep the visible range's blocks loaded — in real line coords, since a
  // collapsed block makes the visual rows skip ahead.
  const first = toReal(items[0]?.index ?? 0)
  const last = toReal(items[items.length - 1]?.index ?? 0)
  useEffect(() => {
    if (total > 0) ensureRange(first, last)
  }, [first, last, total, ensureRange])

  // Debounced backend search.
  useEffect(() => {
    const t = setTimeout(
      () => runSearch(query, { caseSensitive: false, wholeWord: false }),
      200,
    )
    return () => clearTimeout(t)
  }, [query, runSearch])

  // Debounced backend JSONPath filter.
  useEffect(() => {
    const t = setTimeout(() => applyFilter(filterQuery), 250)
    return () => clearTimeout(t)
  }, [filterQuery, applyFilter])

  function closeFilter() {
    setFilterQuery("")
    applyFilter("")
    setFilterOpen(false)
  }

  const activeMatch = search.active >= 0 ? search.matches[search.active] : null
  useEffect(() => {
    if (!activeMatch) return
    reveal(activeMatch.line)
    virt.scrollToIndex(toVisual(activeMatch.line), { align: "center" })
  }, [activeMatch, virt, reveal, toVisual])

  // Re-measure rows when the font setting (and thus row height) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on lineH change
  useEffect(() => virt.measure(), [lineH])

  const gutter = `${String(total).length + 1}ch`

  const filterStatus = filter?.error
    ? filter.error
    : filter
      ? filter.matchCount === 0
        ? "no matches"
        : `${filter.matchCount} match${filter.matchCount === 1 ? "" : "es"}`
      : null

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {filterOpen && (
        <div
          className={cn(
            "shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-surface",
            filter?.error ? "border-error/60" : "border-border",
          )}
        >
          <Glyph
            kind="filter"
            size={12}
            color={filter?.error ? "var(--base08)" : "var(--base04)"}
          />
          <input
            autoFocus
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeFilter()}
            placeholder="$.field  ·  $.items[*].name  ·  $..author"
            spellCheck={false}
            className="flex-1 bg-transparent border-none outline-none font-mono text-[0.786rem] text-fg placeholder:text-muted"
          />
          {filterQuery.trim() && filterStatus && (
            <span
              className={cn(
                "font-mono text-[0.714rem] shrink-0",
                filter?.error ? "text-error" : "text-muted",
              )}
            >
              {filterStatus}
            </span>
          )}
          <button
            type="button"
            onClick={closeFilter}
            className="text-muted hover:text-fg bg-transparent border-0 cursor-pointer"
          >
            <Glyph kind="x" size={11} color="currentColor" />
          </button>
        </div>
      )}

      {findOpen ? (
        <FindBar
          query={query}
          onChange={setQuery}
          onNext={() => stepMatch(1)}
          onPrev={() => stepMatch(-1)}
          onClose={() => setFindOpen(false)}
          status={
            query.trim()
              ? search.total === 0
                ? "no matches"
                : `${search.active + 1}/${search.total}${search.truncated ? "+" : ""}`
              : null
          }
        />
      ) : (
        !filterOpen && (
          <div className="absolute top-1.5 right-4 z-10 flex items-center gap-1">
            {json && (
              <button
                type="button"
                title="Filter by JSONPath"
                onClick={() => setFilterOpen(true)}
                className="p-1 rounded-[3px] border border-border text-muted hover:text-fg hover:border-fg/30 bg-transparent cursor-pointer transition-colors"
              >
                <Glyph kind="filter" size={13} color="currentColor" />
              </button>
            )}
            <button
              type="button"
              title="Find in response"
              onClick={() => setFindOpen(true)}
              className="p-1 rounded-[3px] border border-border text-muted hover:text-fg hover:border-fg/30 bg-transparent cursor-pointer transition-colors"
            >
              <Glyph kind="search" size={13} color="currentColor" />
            </button>
          </div>
        )
      )}

      <div
        ref={parentRef}
        className="flex-1 overflow-auto selection:bg-accent/30"
        style={{
          fontFamily: "var(--editor-font-family)",
          fontSize: `${fontSize}px`,
          lineHeight: `${lineH}px`,
        }}
      >
        <VirtualBodyLines
          items={items}
          totalSize={virt.getTotalSize()}
          lineH={lineH}
          gutterWidth={gutter}
          json={json}
          getLine={getLine}
          getFoldEnd={getFoldEnd}
          toReal={toReal}
          collapsed={collapsed}
          onToggle={toggle}
          activeLine={activeMatch?.line ?? null}
        />
      </div>
    </div>
  )
}
