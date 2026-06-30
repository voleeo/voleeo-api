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

function capPush<T>(prev: T[], item: T): T[] {
  return prev.length >= MAX_FRAMES
    ? [...prev.slice(prev.length - MAX_FRAMES + 1), item]
    : [...prev, item]
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
  appendFrame: (requestId: string, frame: SseFrame, row?: TimelineEvent) => void
  clear: (requestId: string) => void
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
  appendFrame: (requestId, frame, row) =>
    set((s) => {
      const next: Partial<SseStore> = {
        frames: {
          ...s.frames,
          [requestId]: capPush(s.frames[requestId] ?? [], frame),
        },
        bytes: {
          ...s.bytes,
          [requestId]:
            (s.bytes[requestId] ?? 0) + ENC.encode(frame.data).length,
        },
      }
      if (row)
        next.timeline = {
          ...s.timeline,
          [requestId]: capPush(s.timeline[requestId] ?? [], row),
        }
      return next
    }),
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
