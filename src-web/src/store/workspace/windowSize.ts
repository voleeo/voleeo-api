import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window"
import { isWindows } from "@/lib/platform"
import { patchSettings } from "@/lib/workspaceSettings"

export const WELCOME_WIDTH = 900
export const WELCOME_HEIGHT = 680
export const DEFAULT_WORKSPACE_WIDTH = 1000
export const DEFAULT_WORKSPACE_HEIGHT = 800

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

    if (await win.isFullscreen().catch(() => false))
      await win.setFullscreen(false)

    if (await win.isMaximized().catch(() => false)) await win.unmaximize()

    await win.setResizable(resizable)
    try {
      await win.setMinSize(new LogicalSize(WELCOME_WIDTH, WELCOME_HEIGHT))
    } catch {}
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

export function applyWelcomeWindowSize() {
  return applyWindowSize(WELCOME_WIDTH, WELCOME_HEIGHT, isWindows)
}

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
