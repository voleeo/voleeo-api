import { CodeView } from "@/components/CodeView"
import { cn } from "@/lib/utils"
import type {
  GrpcStreamMessage,
  HttpResponseHeader,
  TimelineEvent,
} from "../../../../../packages/types/bindings"

export function byteLen(s: string | undefined): number {
  return s ? new TextEncoder().encode(s).length : 0
}

export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function UnaryBody({
  error,
  message,
}: {
  error?: string
  message?: string
}) {
  if (error)
    return (
      <p className="px-3.5 py-3 font-mono text-[0.857rem] text-destructive whitespace-pre-wrap break-words">
        {error}
      </p>
    )
  if (message === undefined)
    return (
      <p className="px-3.5 py-3 font-mono text-[0.857rem] text-muted">
        Send the request to see the response.
      </p>
    )
  return (
    <div className="px-2 py-1 selectable-text">
      <CodeView value={prettyJson(message)} lang="json" />
    </div>
  )
}

export function HeaderTable({
  rows,
  empty,
}: {
  rows: HttpResponseHeader[]
  empty: string
}) {
  if (rows.length === 0)
    return (
      <p className="px-3.5 py-3 font-mono text-[0.857rem] text-muted">
        {empty}
      </p>
    )
  return (
    <div className="flex flex-col selectable-text">
      {rows.map((h, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: header lists can repeat keys
          key={`${h.name}-${i}`}
          className="px-3.5 py-1.5 border-b border-border/50 grid grid-cols-[minmax(0,12rem)_1fr] gap-3"
        >
          <span className="font-mono text-[0.786rem] text-muted truncate">
            {h.name}
          </span>
          <span className="font-mono text-[0.786rem] text-fg break-words min-w-0">
            {h.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TranscriptList({
  messages,
}: {
  messages: GrpcStreamMessage[]
}) {
  if (messages.length === 0)
    return (
      <p className="px-3.5 py-3 font-mono text-[0.857rem] text-muted">
        No messages yet.
      </p>
    )
  return (
    <div className="flex flex-col selectable-text">
      {messages.map((m) => (
        <div
          key={m.id}
          className="px-3.5 py-1.5 border-b border-border/50 flex gap-2"
        >
          <span
            className={cn(
              "font-mono text-[0.72rem] shrink-0",
              m.direction === "outgoing" ? "text-accent" : "text-success",
            )}
          >
            {m.direction === "outgoing" ? "↑" : "↓"}
          </span>
          <pre className="font-mono text-[0.857rem] text-fg whitespace-pre-wrap break-words flex-1 min-w-0">
            {prettyJson(m.data)}
          </pre>
        </div>
      ))}
    </div>
  )
}

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0)
    return (
      <p className="px-3.5 py-3 font-mono text-[0.857rem] text-muted">
        No events.
      </p>
    )
  return (
    <div className="flex flex-col">
      {events.map((e, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only event log
          key={i}
          className="px-3.5 py-1 flex gap-3 font-mono text-[0.72rem]"
        >
          <span className="text-muted w-14 shrink-0 text-right">
            {Math.round(e.atMs ?? 0)}ms
          </span>
          <span
            className={cn(
              "w-16 shrink-0",
              e.kind === "error" ? "text-destructive" : "text-accent",
            )}
          >
            {e.kind}
          </span>
          <span className="text-fg flex-1 min-w-0 break-words">{e.text}</span>
        </div>
      ))}
    </div>
  )
}
