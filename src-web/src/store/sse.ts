import { create } from "zustand"
import type {
  HttpResponseHeader,
  SseFrame,
  TimelineEvent,
} from "../../../packages/types/bindings"

export type { SseFrame }

// Cap kept frames so an endless stream can't grow without bound. Matches the
// backend's SSE_FRAME_CAP so the live view and persisted history agree.
const MAX_FRAMES = 2000
const ENC = new TextEncoder()

// Append a batch in one shot — O(prev + batch) per flush, not per frame, so a
// fast stream doesn't re-clone a 2000-element array on every event.
function capPushMany<T>(prev: T[], items: T[]): T[] {
  if (items.length === 0) return prev
  const combined = [...prev, ...items]
  return combined.length > MAX_FRAMES ? combined.slice(-MAX_FRAMES) : combined
}

/** Response line + headers, captured when the stream opens — lets the header
 *  show real status/headers while still streaming, instead of just "Sending…". */
export interface SseOpen {
  status: number
  statusText: string
  headers: HttpResponseHeader[]
}

interface SseStore {
  frames: Record<string, SseFrame[]>
  // Live Timeline rows: setup events (config/connect/headers) from the open
  // event, then one row per frame — so the Timeline tab fills in as it runs.
  timeline: Record<string, TimelineEvent[]>
  open: Record<string, SseOpen>
  // Cumulative bytes of frame data received (not just kept) — the live "size".
  bytes: Record<string, number>
  setOpen: (requestId: string, open: SseOpen, events: TimelineEvent[]) => void
  appendFrames: (requestId: string, batch: SseFrameRow[]) => void
  clear: (requestId: string) => void
}

/** One coalesced frame and its timeline row, as the backend batches them. */
export interface SseFrameRow {
  frame: SseFrame
  timeline: TimelineEvent
}

export const useSseStore = create<SseStore>((set) => ({
  frames: {},
  timeline: {},
  open: {},
  bytes: {},
  // Prepend events so an early frame that beat the open event still lands after
  // the setup rows (setup elapsed < any frame's, so order stays correct).
  setOpen: (requestId, open, events) =>
    set((s) => ({
      open: { ...s.open, [requestId]: open },
      timeline: {
        ...s.timeline,
        [requestId]: [...events, ...(s.timeline[requestId] ?? [])],
      },
    })),
  appendFrames: (requestId, batch) => {
    if (batch.length === 0) return
    set((s) => {
      let added = 0
      const frames: SseFrame[] = []
      const rows: TimelineEvent[] = []
      for (const b of batch) {
        frames.push(b.frame)
        rows.push(b.timeline)
        added += ENC.encode(b.frame.data).length
      }
      return {
        frames: {
          ...s.frames,
          [requestId]: capPushMany(s.frames[requestId] ?? [], frames),
        },
        timeline: {
          ...s.timeline,
          [requestId]: capPushMany(s.timeline[requestId] ?? [], rows),
        },
        bytes: {
          ...s.bytes,
          [requestId]: (s.bytes[requestId] ?? 0) + added,
        },
      }
    })
  },
  clear: (requestId) =>
    set((s) => {
      if (!s.frames[requestId] && !s.timeline[requestId] && !s.open[requestId])
        return s
      const frames = { ...s.frames }
      const timeline = { ...s.timeline }
      const open = { ...s.open }
      const bytes = { ...s.bytes }
      delete frames[requestId]
      delete timeline[requestId]
      delete open[requestId]
      delete bytes[requestId]
      return { frames, timeline, open, bytes }
    }),
}))
