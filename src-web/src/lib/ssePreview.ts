import type { SseFrame } from "@/store/sse"

export function jsonPreview(value: unknown, budget = 96): string {
  return build(value, { n: budget })
}

/** Reconstruct the SSE wire format from parsed frames — drives the raw view and
 *  the "download as text" action. Comments/heartbeats from the original stream
 *  aren't kept; the frames are the source of truth. */
export function rawSse(frames: SseFrame[]): string {
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

function build(v: unknown, b: { n: number }): string {
  if (v === null) return "null"
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const parts: string[] = []
    for (const x of v) {
      if (b.n < 0) {
        parts.push("…")
        break
      }
      const s = build(x, b)
      b.n -= s.length + 2
      parts.push(s)
    }
    return `[${parts.join(", ")}]`
  }
  if (typeof v === "object") {
    const parts: string[] = []
    for (const k of Object.keys(v as object)) {
      if (b.n < 0) {
        parts.push("…")
        break
      }
      const s = `"${k}": ${build((v as Record<string, unknown>)[k], b)}`
      b.n -= s.length + 2
      parts.push(s)
    }
    return `{ ${parts.join(", ")} }`
  }
  return String(v)
}

export function tryParseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}
