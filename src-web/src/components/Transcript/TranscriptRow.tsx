import { memo, useMemo } from "react"
import { CodeView } from "@/components/CodeView"
import { Glyph } from "@/components/Glyph"
import { jsonPreview, tryParseJson } from "@/lib/ssePreview"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/views/ApiWorkspace/ResponsePane/format"
import { jsonLineTokens } from "@/views/ApiWorkspace/ResponsePane/jsonLineTokens"
import { CopyButton } from "@/views/ApiWorkspace/ResponsePane/SseStreamTab/CopyButton"
import type { TranscriptMessage } from "./types"

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

function Preview({ json, text }: { json: unknown; text: string }) {
  if (json !== undefined)
    return (
      <span className="truncate min-w-0">
        <JsonTokens line={jsonPreview(json)} />
      </span>
    )
  return (
    <span className="truncate min-w-0 text-muted">{text.split("\n")[0]}</span>
  )
}

function TranscriptRowImpl({
  message,
  open,
  onToggle,
  fontSize,
  rowH,
}: {
  message: TranscriptMessage
  open: boolean
  onToggle: (id: string) => void
  fontSize: number
  rowH: number
}) {
  const outgoing = message.direction === "outgoing"
  const color = outgoing ? "var(--base0D)" : "var(--base0B)"
  const { json, isJson, raw } = useMemo(() => {
    const parsed = tryParseJson(message.data)
    const ok = parsed !== undefined
    return {
      json: parsed,
      isJson: ok,
      raw: ok ? JSON.stringify(parsed, null, 2) : message.data,
    }
  }, [message.data])

  return (
    <div
      className={cn("group border-b border-border/60", open && "bg-surface/40")}
    >
      <button
        type="button"
        onClick={() => onToggle(message.id)}
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
          {outgoing ? "↑" : "↓"}
        </span>
        {message.kind && (
          <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 text-[0.6rem] font-medium uppercase text-muted/70">
            {message.kind}
          </span>
        )}
        <span
          className="flex flex-1 items-center min-w-0 transition-opacity"
          style={{ opacity: open ? 0.45 : 1 }}
        >
          <Preview json={json} text={message.data} />
        </span>
        <span className="shrink-0 text-muted/60">
          {formatBytes(message.size)}
        </span>
      </button>

      {open && (
        <div className="pl-3.5 pr-[18px] pt-1 pb-4">
          <div className="relative rounded-[10px] border border-border overflow-hidden bg-bg">
            <CopyButton text={raw} className="absolute top-1.5 right-2 z-10" />
            <CodeView
              value={raw}
              lang={isJson ? "json" : "text"}
              lineNumbers
              wrap={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Memoized so rows re-render only on their own open/message change, not on every parent keystroke/scroll.
// Needs a stable `onToggle` (see TranscriptView).
export const TranscriptRow = memo(TranscriptRowImpl)
