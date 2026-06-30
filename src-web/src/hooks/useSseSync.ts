import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import { type SseFrame, useSseStore } from "@/store/sse"
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
    const unFrame = listen<{
      requestId: string
      frame: SseFrame
      timeline?: TimelineEvent
    }>(EVENTS.sseFrame, ({ payload }) => {
      useSseStore
        .getState()
        .appendFrame(payload.requestId, payload.frame, payload.timeline)
    })
    return () => {
      unOpen.then((f) => f())
      unFrame.then((f) => f())
    }
  }, [])
}
