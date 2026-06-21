import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window"
import { isMac } from "@/lib/platform"
import { patchSettings } from "@/lib/workspaceSettings"

export const WELCOME_RESIZABLE = !isMac

export const WELCOME_WIDTH = 900
export const WELCOME_HEIGHT = 680
export const DEFAULT_WORKSPACE_WIDTH = 1000
export const DEFAULT_WORKSPACE_HEIGHT = 800

// Programmatic resizes fire `onResized`; this counter suppresses persisting them.
let ignoringResizeCount = 0

export async function applyWindowSize(
  width: number,
  height: number,
  resizable = true,
) {
  try {
    const win = getCurrentWebviewWindow()
    const monitor = await currentMonitor()
    ignoringResizeCount += 1
    await win.setResizable(resizable)
    await win.setSize(new LogicalSize(width, height))
    if (monitor) {
      const sf = monitor.scaleFactor
      const mw = monitor.size.width / sf
      const mh = monitor.size.height / sf
      const mx = monitor.position.x / sf
      const my = monitor.position.y / sf
      await win.setPosition(
        new LogicalPosition(
          Math.round(mx + (mw - width) / 2),
          Math.round(my + (mh - height) / 2),
        ),
      )
    }
  } catch {
  } finally {
    setTimeout(() => {
      ignoringResizeCount -= 1
    }, 600)
  }
}

/** Resize + centre the window to the welcome-screen dimensions. */
export function applyWelcomeWindowSize() {
  return applyWindowSize(WELCOME_WIDTH, WELCOME_HEIGHT, WELCOME_RESIZABLE)
}

/** Persist user-driven window resizes (debounced) for the active workspace. */
export function attachResizeListener(
  getActiveWorkspaceId: () => string | null,
) {
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  getCurrentWebviewWindow()
    .onResized(async ({ payload: size }) => {
      if (ignoringResizeCount > 0) return
      const activeWorkspaceId = getActiveWorkspaceId()
      if (!activeWorkspaceId) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(async () => {
        try {
          // onResized delivers physical pixels — convert to logical before saving
          const monitor = await currentMonitor()
          const sf = monitor?.scaleFactor ?? 1
          patchSettings(activeWorkspaceId, {
            windowSize: {
              width: Math.round(size.width / sf),
              height: Math.round(size.height / sf),
            },
          })
        } catch {}
      }, 500)
    })
    .catch(() => {})
}
