import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import { type GrpcStatus, useGrpcStore } from "@/store/grpc"
import { useRequestStore } from "@/store/requests"
import type {
  GrpcStreamMessage,
  TimelineEvent,
} from "../../../packages/types/bindings"

export function useGrpcSync() {
  useEffect(() => {
    const unStatus = listen<{ requestId: string; status: GrpcStatus }>(
      EVENTS.grpcStatus,
      ({ payload }) => {
        useGrpcStore.getState().setStatus(payload.requestId, payload.status)
      },
    )
    const unMessage = listen<{ requestId: string; message: GrpcStreamMessage }>(
      EVENTS.grpcMessage,
      ({ payload }) => {
        useGrpcStore
          .getState()
          .appendMessage(payload.requestId, payload.message)
      },
    )
    const unTimeline = listen<{ requestId: string; event: TimelineEvent }>(
      EVENTS.grpcTimeline,
      ({ payload }) => {
        useGrpcStore.getState().appendTimeline(payload.requestId, payload.event)
      },
    )
    const unChanged = listen<{ workspaceId: string }>(
      EVENTS.mcpGrpcChanged,
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
      unChanged.then((f) => f())
    }
  }, [])
}
