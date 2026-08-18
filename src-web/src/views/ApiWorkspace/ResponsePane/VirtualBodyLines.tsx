import type { VirtualItem } from "@tanstack/react-virtual"
import { Fragment } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { jsonLineTokens } from "./jsonLineTokens"

/** Inline content of a line: JSON gets token coloring, anything else is plain. */
function renderLine(text: string, json: boolean) {
  if (!json) return text
  return jsonLineTokens(text).map((t, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
    <span key={i} style={t.color ? { color: t.color } : undefined}>
      {t.text}
    </span>
  ))
}

/** The text that closes a folded block, so the row reads `{ … },` the way
 *  CodeMirror renders it. ponytail: mirrors the bracket when the closing line
 *  sits outside the loaded window — exact for a root block, drops the trailing
 *  comma on a nested one whose end is far off screen. */
function closerFor(open: string, end: string | undefined): string {
  if (end !== undefined) return end.trim()
  return open.trimEnd().endsWith("[") ? "]" : "}"
}

/** The scrolled content: line numbers, fold chevrons, and the visible lines. */
export function VirtualBodyLines({
  items,
  totalSize,
  lineH,
  gutterWidth,
  json,
  getLine,
  getFoldEnd,
  toReal,
  collapsed,
  onToggle,
  activeLine,
}: {
  items: VirtualItem[]
  totalSize: number
  lineH: number
  gutterWidth: string
  json: boolean
  getLine: (line: number) => string | undefined
  getFoldEnd: (line: number) => number | undefined
  toReal: (visual: number) => number
  collapsed: ReadonlySet<number>
  onToggle: (line: number) => void
  activeLine: number | null
}) {
  const rows = items.map((vi) => ({ vi, line: toReal(vi.index) }))

  return (
    <div style={{ height: totalSize, position: "relative" }}>
      <div
        className="flex"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${items[0]?.start ?? 0}px)`,
        }}
      >
        {/* Line-number gutter — unselectable so copies exclude it. */}
        <div
          className="select-none text-right text-muted pr-1 shrink-0"
          style={{ width: gutterWidth }}
        >
          {rows.map(({ vi, line }) => (
            <div key={vi.key} style={{ height: lineH }}>
              {line + 1}
            </div>
          ))}
        </div>
        {/* Fold column, mirroring CodeMirror's chevron gutter. */}
        <div className="select-none shrink-0 w-[15px] text-muted">
          {rows.map(({ vi, line }) =>
            getFoldEnd(line) ? (
              <button
                key={vi.key}
                type="button"
                aria-label={collapsed.has(line) ? "Expand block" : "Fold block"}
                onClick={() => onToggle(line)}
                className="flex items-center justify-center w-full p-0 border-0 bg-transparent text-inherit hover:text-fg cursor-pointer"
                style={{ height: lineH }}
              >
                <Glyph
                  kind={collapsed.has(line) ? "chevron" : "chevron-down"}
                  size={11}
                  color="currentColor"
                />
              </button>
            ) : (
              <div key={vi.key} style={{ height: lineH }} />
            ),
          )}
        </div>
        {/* The lines render as ONE contiguous block (separated by newlines)
            so native selection spans them with no inter-line gaps. */}
        <div className="selectable-text whitespace-pre flex-1 min-w-0">
          {rows.map(({ vi, line }, idx) => {
            const text = getLine(line) ?? ""
            const end = collapsed.has(line) ? getFoldEnd(line) : undefined
            return (
              <Fragment key={vi.key}>
                <span className={cn(activeLine === line && "bg-accent/15")}>
                  {renderLine(text, json)}
                </span>
                {end !== undefined && (
                  <span className="select-none">
                    <span className="text-muted"> … </span>
                    {renderLine(closerFor(text, getLine(end)), json)}
                  </span>
                )}
                {idx < rows.length - 1 ? "\n" : ""}
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
