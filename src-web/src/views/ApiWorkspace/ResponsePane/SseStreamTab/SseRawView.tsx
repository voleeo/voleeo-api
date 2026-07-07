import { useMemo } from "react"
import { CodeView } from "@/components/CodeView"
import { rawSse } from "@/lib/ssePreview"
import type { SseFrame } from "@/store/sse"

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
