import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import { useCookiesStore } from "@/store/cookies"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"

export function useMcpSync() {
  useEffect(() => {
    const unlisten1 = listen<{ workspaceId: string }>(
      EVENTS.mcpRequestsChanged,
      ({ payload }) => {
        if (
          payload.workspaceId === useRequestStore.getState().loadedWorkspaceId
        ) {
          useRequestStore.getState().reload()
        }
      },
    )
    const unlisten2 = listen<{ workspaceId: string }>(
      EVENTS.mcpEnvsChanged,
      ({ payload }) => {
        if (
          payload.workspaceId ===
          useEnvironmentStore.getState().loadedWorkspaceId
        ) {
          useEnvironmentStore.getState().reload()
        }
      },
    )

    const unlisten3 = listen<{ workspaceId: string }>(
      EVENTS.mcpCookiesChanged,
      ({ payload }) => {
        if (
          payload.workspaceId === useCookiesStore.getState().loadedWorkspaceId
        ) {
          useCookiesStore.getState().reload()
        }
      },
    )
    return () => {
      unlisten1.then((f) => f())
      unlisten2.then((f) => f())
      unlisten3.then((f) => f())
    }
  }, [])
}
