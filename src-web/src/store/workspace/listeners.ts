import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { exit } from "@tauri-apps/plugin-process"
import { EVENTS } from "@/config/events"
import { useUiStore } from "./index"
import { applyWelcomeWindowSize } from "./windowSize"

function stopRunningRequests(workspaceId: string | null) {
  import("../http")
    .then(({ useHttpStore }) => {
      const s = useHttpStore.getState()
      for (const [id, isLoading] of Object.entries(s.loading)) {
        if (isLoading) void s.cancelRequest(id)
      }
    })
    .catch(() => {})
  if (!workspaceId) return
  import("../websocket")
    .then(({ useWebsocketStore }) => {
      const s = useWebsocketStore.getState()
      for (const [id, status] of Object.entries(s.status)) {
        if (status === "open" || status === "connecting")
          void s.disconnect(workspaceId, id)
      }
    })
    .catch(() => {})
  import("../grpc")
    .then(({ useGrpcStore }) => {
      const s = useGrpcStore.getState()
      for (const [id, status] of Object.entries(s.status)) {
        if (status === "streaming" || status === "connecting")
          void s.cancelStream(workspaceId, id)
      }
    })
    .catch(() => {})
}

/** Reset the per-workspace tool stores when a workspace closes. */
function resetWorkspaceStores() {
  import("../environment")
    .then(({ useEnvironmentStore }) => useEnvironmentStore.getState().reset())
    .catch(() => {})
  import("../cookies")
    .then(({ useCookiesStore }) => useCookiesStore.getState().reset())
    .catch(() => {})
  import("../git")
    .then(({ useGitStore }) => useGitStore.getState().reset())
    .catch(() => {})
  import("../sse")
    .then(({ useSseStore }) => useSseStore.getState().reset())
    .catch(() => {})
}

/**
 * Wire the cross-window workspace events. Side-effecting `listen()` calls must
 * run exactly once per window — call from `main.tsx`, never at import time.
 */
export function initWorkspaceListeners() {
  listen<{ workspaceId: string; windowLabel: string }>(
    EVENTS.workspaceRegistered,
    (e) => {
      useUiStore.setState((s) => ({
        workspaceWindowMap: {
          ...s.workspaceWindowMap,
          [e.payload.workspaceId]: e.payload.windowLabel,
        },
      }))
    },
  ).catch(() => {})

  listen(EVENTS.workspaceAnnounce, () => {
    const { activeWorkspaceId } = useUiStore.getState()
    if (!activeWorkspaceId) return
    try {
      const label = getCurrentWebviewWindow().label
      emit(EVENTS.workspaceRegistered, {
        workspaceId: activeWorkspaceId,
        windowLabel: label,
      }).catch(() => {})
    } catch {}
  }).catch(() => {})

  listen(EVENTS.workspaceClose, () => {
    stopRunningRequests(useUiStore.getState().activeWorkspaceId)
    useUiStore.setState({ activeTool: "welcome", activeWorkspaceId: null })
    applyWelcomeWindowSize()
    resetWorkspaceStores()
  }).catch(() => {})

  try {
    const win = getCurrentWebviewWindow()
    if (win.label === "main") {
      win
        .onCloseRequested((event) => {
          if (useUiStore.getState().activeWorkspaceId) {
            event.preventDefault()
            emit(EVENTS.workspaceClose, {}).catch(() => {})
          } else {
            event.preventDefault()
            exit(0).catch(() => {})
          }
        })
        .catch(() => {})
    }
  } catch {}
}
