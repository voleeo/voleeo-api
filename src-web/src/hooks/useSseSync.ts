import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import { type SseFrameRow, useSseStore } from "@/store/sse"
import type {
  HttpResponseHeader,
  TimelineEvent,
} from "../../../packages/types/bindings"

export function useSseSync() {
  useEffect(() => {
    const unOpen = listen<{
      requestId: string
      status: number
      statusText: string
      headers: HttpResponseHeader[]
      events: TimelineEvent[]
    }>(EVENTS.sseOpen, ({ payload }) => {
      useSseStore.getState().setOpen(
        payload.requestId,
        {
          status: payload.status,
          statusText: payload.statusText,
          headers: payload.headers,
        },
        payload.events,
      )
    })
    const unFrames = listen<{
      requestId: string
      frames: SseFrameRow[]
    }>(EVENTS.sseFrames, ({ payload }) => {
      useSseStore.getState().appendFrames(payload.requestId, payload.frames)
    })
    return () => {
      unOpen.then((f) => f())
      unFrames.then((f) => f())
    }
  }, [])
}
