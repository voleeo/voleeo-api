import { memo, useMemo } from "react"
import { Glyph } from "@/components/Glyph"
import { jsonPreview, tryParseJson } from "@/lib/ssePreview"
import { cn } from "@/lib/utils"
import type { SseFrame } from "@/store/sse"
import { formatDuration } from "../format"
import { jsonLineTokens } from "../jsonLineTokens"
import { CopyButton } from "./CopyButton"
import { eventColor } from "./eventColor"

/** Color one line of JSON with the shared body-tab tokenizer. */
function JsonTokens({ line }: { line: string }) {
  return (
    <>
      {jsonLineTokens(line).map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
        <span key={i} style={t.color ? { color: t.color } : undefined}>
          {t.text}
        </span>
      ))}
    </>
  )
}

/** Inline collapsed-row preview: compact JSON, or the first text line. */
function Preview({ json, text }: { json: unknown; text: string }) {
  if (json !== undefined) {
    return (
      <span className="truncate min-w-0">
        <JsonTokens line={jsonPreview(json)} />
      </span>
    )
  }
  const lines = text.split("\n")
  return (
    <span className="truncate min-w-0 text-muted">
      {lines[0]}
      {lines.length > 1 && (
        <span className="ml-2 text-[0.7rem] text-muted/60">
          +{lines.length - 1} more line{lines.length - 1 === 1 ? "" : "s"}
        </span>
      )}
    </span>
  )
}

function FrameRowImpl({
  frame,
  open,
  onToggle,
  fontSize,
  rowH,
}: {
  frame: SseFrame
  open: boolean
  onToggle: (seq: number) => void
  fontSize: number
  rowH: number
}) {
  const color = eventColor(frame.event)
  const { json, isJson, raw } = useMemo(() => {
    const parsed = tryParseJson(frame.data)
    const ok = parsed !== undefined
    return {
      json: parsed,
      isJson: ok,
      raw: ok ? JSON.stringify(parsed, null, 2) : frame.data,
    }
  }, [frame.data])

  return (
    <div
      className={cn("group border-b border-border/60", open && "bg-surface/40")}
    >
      {/* collapsed line */}
      <button
        type="button"
        onClick={() => onToggle(frame.seq)}
        style={{ height: rowH, fontSize }}
        className={cn(
          "relative flex w-full items-center gap-2.5 pl-3.5 pr-[18px] cursor-pointer text-left font-mono",
          !open && "group-hover:bg-surface/25",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-0 bottom-0 w-[2.5px] transition-opacity",
            open ? "opacity-100" : "opacity-0 group-hover:opacity-50",
          )}
          style={{ background: color }}
        />
        <span
          className="flex shrink-0 transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          <Glyph kind="chevron" size={11} color="var(--base04)" />
        </span>
        <span className="shrink-0 font-semibold" style={{ color }}>
          {frame.event ?? "message"}
        </span>
        <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 text-[0.65rem] font-medium text-muted/70 tabular-nums">
          #{frame.seq}
        </span>
        <span
          className="flex flex-1 items-center min-w-0 transition-opacity"
          style={{ opacity: open ? 0.45 : 1 }}
        >
          <Preview json={json} text={frame.data} />
        </span>
        <span className="shrink-0 text-muted/60">
          {formatDuration(frame.atMs ?? 0)}
        </span>
      </button>

      {open && (
        <div className="pl-9 pr-[18px] pt-1 pb-4">
          <div className="relative rounded-[10px] border border-border overflow-hidden bg-bg">
            <CopyButton text={raw} className="absolute top-1.5 right-2 z-10" />
            <div className="px-3.5 py-3 overflow-x-auto">
              <pre
                className="selectable-text cursor-text m-0 font-mono text-fg whitespace-pre"
                style={{ fontSize, lineHeight: 1.65 }}
              >
                {isJson
                  ? raw.split("\n").map((ln, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional within stable pretty JSON
                      <div key={i}>
                        <JsonTokens line={ln} />
                      </div>
                    ))
                  : raw}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Memoized: rows re-render only when their own open/frame changes, not on every
// keystroke/scroll of the parent. Needs a stable `onToggle` (see index.tsx).
export const FrameRow = memo(FrameRowImpl)
