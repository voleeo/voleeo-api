import { useMemo } from "react"
import { CodeView } from "@/components/CodeView"
import type { SseFrame } from "@/store/sse"

/** Reconstruct the SSE wire format from parsed frames.
 *  Comments/heartbeats from the original stream aren't kept — the frames are the source of truth. */
function rawSse(frames: SseFrame[]): string {
  const blocks = frames.map((f) => {
    const lines: string[] = []
    if (f.event) lines.push(`event: ${f.event}`)
    if (f.lastEventId) lines.push(`id: ${f.lastEventId}`)
    if (f.retry != null) lines.push(`retry: ${f.retry}`)
    for (const d of f.data.split("\n")) lines.push(`data: ${d}`)
    return lines.join("\n")
  })
  return blocks.length ? `${blocks.join("\n\n")}\n` : ""
}

/** Raw view of an SSE stream: the reconstructed wire text, line-numbered. */
export function SseRawView({ frames }: { frames: SseFrame[] }) {
  const text = useMemo(() => rawSse(frames), [frames])
  return (
    <div className="flex-1 min-h-0">
      <CodeView
        value={text}
        lang="text"
        lineNumbers
        wrap={false}
        height="100%"
      />
    </div>
  )
}
