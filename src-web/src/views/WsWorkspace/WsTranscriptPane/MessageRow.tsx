import { cn } from "@/lib/utils"
import type { WsMessage } from "../../../../../packages/types/bindings"

function formatTime(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString()
}

export function MessageRow({ m }: { m: WsMessage }) {
  const out = m.direction === "outgoing"
  return (
    <div className="flex gap-2 px-3 py-1.5 border-b border-border/50 hover:bg-subtle">
      <span
        title={out ? "Sent" : "Received"}
        className={cn(
          "font-mono text-[0.857rem] shrink-0",
          out ? "text-accent" : "text-success",
        )}
      >
        {out ? "↑" : "↓"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[0.643rem] font-mono text-muted">
          <span>{formatTime(m.at)}</span>
          <span className="uppercase">{m.kind}</span>
          <span>{m.size} B</span>
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono text-[0.786rem] text-fg mt-0.5">
          {m.data}
        </pre>
      </div>
    </div>
  )
}
