import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { methodColor } from "@/components/tokens"
import { Spinner } from "@/components/ui/spinner"
import type { BodyLang } from "../ResponsePane/bodyLang"
import { UrlInput } from "../UrlInput"

const noop = () => {}

function MaskedValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="flex items-center gap-1.5 px-1 py-0.5 min-w-0">
      <span className="font-mono text-[0.786rem] text-fg break-all select-text">
        {shown ? value : "•".repeat(9)}
      </span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        title={shown ? "Hide value" : "Reveal value"}
        className="shrink-0 text-muted hover:text-fg cursor-pointer"
      >
        <Glyph kind={shown ? "hide" : "view"} size={14} color="currentColor" />
      </button>
    </span>
  )
}

export function FrozenActionBar({
  method,
  url,
  replaying,
  onReplay,
}: {
  method: string
  url: string
  replaying: boolean
  onReplay: () => void
}) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="group flex items-center border border-border rounded-[5px] bg-surface overflow-hidden">
        <div
          className="self-stretch px-2.5 editor-font font-semibold flex items-center cursor-default outline-none border-0 bg-transparent border-r border-border shrink-0"
          style={{ color: methodColor(method), fontSize: "0.786rem" }}
        >
          {method}
        </div>
        <UrlInput
          value={url}
          readOnly
          disabled={false}
          onChange={noop}
          onCommit={noop}
          onSend={noop}
        />
        <button
          type="button"
          disabled={replaying}
          onClick={onReplay}
          aria-label="Replay saved snapshot"
          title="Replay"
          className="self-stretch px-2.5 border-l border-border flex items-center justify-center cursor-pointer bg-transparent hover:bg-subtle disabled:cursor-not-allowed outline-none shrink-0 transition-colors"
        >
          {replaying ? (
            <Spinner className="size-3.5" aria-hidden />
          ) : (
            <Glyph kind="arrows-clockwise" size={14} color="var(--base0B)" />
          )}
        </button>
      </div>
    </div>
  )
}

export function KVTable({
  rows,
  emptyLabel = "None",
}: {
  rows: { name: string; value: string; secret?: boolean }[]
  emptyLabel?: string
}) {
  if (rows.length === 0) {
    return (
      <div className="px-3.5 py-3 text-xs text-muted font-sans">
        {emptyLabel}
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-auto max-h-full px-3.5 pt-1">
      {rows.map((r) => (
        <div
          key={`${r.name}:${r.value}`}
          className="grid gap-x-1 py-[3px] items-start border-b border-border/40"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          <span className="font-mono text-[0.786rem] text-fg px-1 py-0.5 truncate select-text">
            {r.name}
          </span>
          {r.secret ? (
            <MaskedValue value={r.value} />
          ) : (
            <span className="font-mono text-[0.786rem] text-fg px-1 py-0.5 break-all select-text">
              {r.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export function bodyLangForKind(kind: string | undefined): BodyLang {
  if (kind === "json" || kind === "graphql") return "json"
  if (kind === "xml") return "xml"
  return "plain"
}
