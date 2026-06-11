import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { type GrpcStatus, useGrpcStore } from "@/store/grpc"
import { useRequestStore } from "@/store/requests"
import type {
  GrpcStreamMessage,
  TimelineEvent,
} from "../../../packages/types/bindings"

/** Subscribe once to the backend's `grpc:*` event stream and the MCP
 *  gRPC-change notification. Payloads carry `requestId`, so one listener per
 *  channel feeds every streaming call's state. Mirrors `useWsSync`. */
export function useGrpcSync() {
  useEffect(() => {
    const unStatus = listen<{ requestId: string; status: GrpcStatus }>(
      "grpc:status",
      ({ payload }) => {
        useGrpcStore.getState().setStatus(payload.requestId, payload.status)
      },
    )
    const unMessage = listen<{ requestId: string; message: GrpcStreamMessage }>(
      "grpc:message",
      ({ payload }) => {
        useGrpcStore
          .getState()
          .appendMessage(payload.requestId, payload.message)
      },
    )
    const unTimeline = listen<{ requestId: string; event: TimelineEvent }>(
      "grpc:timeline",
      ({ payload }) => {
        useGrpcStore.getState().appendTimeline(payload.requestId, payload.event)
      },
    )
    const unChanged = listen<{ workspaceId: string }>(
      "mcp:grpc:changed",
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
