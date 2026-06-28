import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import { useRequestStore } from "@/store/requests"
import { useWebsocketStore, type WsConnStatus } from "@/store/websocket"
import type { TimelineEvent, WsMessage } from "../../../packages/types/bindings"

export function useWsSync() {
  useEffect(() => {
    const unStatus = listen<{ connectionId: string; status: WsConnStatus }>(
      EVENTS.wsStatus,
      ({ payload }) => {
        useWebsocketStore
          .getState()
          .setStatus(payload.connectionId, payload.status)
      },
    )
    const unMessage = listen<{ connectionId: string; message: WsMessage }>(
      EVENTS.wsMessage,
      ({ payload }) => {
        useWebsocketStore
          .getState()
          .appendMessage(payload.connectionId, payload.message)
      },
    )
    const unTimeline = listen<{ connectionId: string; event: TimelineEvent }>(
      EVENTS.wsTimeline,
      ({ payload }) => {
        useWebsocketStore
          .getState()
          .appendTimeline(payload.connectionId, payload.event)
      },
    )

    const unConnections = listen<{ workspaceId: string }>(
      EVENTS.mcpConnectionsChanged,
      ({ payload }) => {
        if (
          payload.workspaceId === useRequestStore.getState().loadedWorkspaceId
        )
          useRequestStore.getState().reload()
      },
    )
    return () => {
      unStatus.then((f) => f())
      unMessage.then((f) => f())
      unTimeline.then((f) => f())
      unConnections.then((f) => f())
    }
  }, [])
}
