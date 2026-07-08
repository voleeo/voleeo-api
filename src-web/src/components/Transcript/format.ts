import { formatBytes } from "@/views/ApiWorkspace/ResponsePane/format"
import type { TranscriptMessage } from "./types"

export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function formatTime(at?: string): string {
  if (!at) return ""
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString()
}

export function rawMessageHeader(m: TranscriptMessage, index: number): string {
  const parts = [
    `#${index + 1}`,
    m.direction === "outgoing" ? "sent" : "received",
  ]
  if (m.kind) parts.push(m.kind)
  parts.push(formatBytes(m.size))
  const time = formatTime(m.at)
  if (time) parts.push(time)
  return `// ${parts.join(" · ")}`
}
