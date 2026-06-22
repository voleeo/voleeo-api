import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { exit } from "@tauri-apps/plugin-process"
import { useUiStore } from "./index"
import { applyWelcomeWindowSize } from "./windowSize"

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
}

/**
 * Wire the cross-window workspace events. Side-effecting `listen()` calls must
 * run exactly once per window — call from `main.tsx`, never at import time.
 */
export function initWorkspaceListeners() {
  listen<{ workspaceId: string; windowLabel: string }>(
    "workspace:window:registered",
    (e) => {
      useUiStore.setState((s) => ({
        workspaceWindowMap: {
          ...s.workspaceWindowMap,
          [e.payload.workspaceId]: e.payload.windowLabel,
        },
      }))
    },
  ).catch(() => {})

  listen("workspace:window:announce", () => {
    const { activeWorkspaceId } = useUiStore.getState()
    if (!activeWorkspaceId) return
    try {
      const label = getCurrentWebviewWindow().label
      emit("workspace:window:registered", {
        workspaceId: activeWorkspaceId,
        windowLabel: label,
      }).catch(() => {})
    } catch {}
  }).catch(() => {})

  listen("workspace:close", () => {
    useUiStore.setState({ activeTool: "welcome", activeWorkspaceId: null })
    applyWelcomeWindowSize()
    resetWorkspaceStores()
  }).catch(() => {})

  // Intercept the main window's close. With a workspace open, prevent the close and step back to Welcome.
  // On Welcome, quit the process directly via the process plugin this can't be blocked by any backend `prevent_close`
  // so the app always closes regardless of the Rust close handler's state.
  try {
    const win = getCurrentWebviewWindow()
    if (win.label === "main") {
      win
        .onCloseRequested((event) => {
          if (useUiStore.getState().activeWorkspaceId) {
            event.preventDefault()
            emit("workspace:close", {}).catch(() => {})
          } else {
            event.preventDefault()
            exit(0).catch(() => {})
          }
        })
        .catch(() => {})
    }
  } catch {}
}
