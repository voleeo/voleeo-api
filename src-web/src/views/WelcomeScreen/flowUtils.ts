import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window"
import { isMac } from "@/lib/platform"

export const FLOW_WIDTH = 900
const MIN_HEIGHT = 280

const TOP_CHROME = isMac ? 40 : 0

export async function applyFlowWindowHeight(height: number) {
  try {
    const win = getCurrentWebviewWindow()
    const monitor = await currentMonitor()
    // Leave 80px margin for macOS menu bar + dock; fall back to 900 if no monitor info
    const maxH = monitor
      ? Math.floor(monitor.size.height / monitor.scaleFactor) - 80
      : 900
    const contentH = Math.max(MIN_HEIGHT, Math.min(height, maxH - TOP_CHROME))
    const windowH = contentH + TOP_CHROME
    // Lower the OS min-height first: the window's configured minHeight (680)
    // would otherwise clamp short flows back up on resizable Windows/Linux,
    // re-introducing the empty space. Width stays at the 900 floor. Its own
    // try/catch so a failure here never skips the setSize below.
    try {
      await win.setMinSize(new LogicalSize(FLOW_WIDTH, MIN_HEIGHT))
    } catch {}
    await win.setSize(new LogicalSize(FLOW_WIDTH, windowH))
    if (monitor) {
      const sf = monitor.scaleFactor
      const mw = monitor.size.width / sf
      const mh = monitor.size.height / sf
      const mx = monitor.position.x / sf
      const my = monitor.position.y / sf
      await win.setPosition(
        new LogicalPosition(
          Math.round(mx + (mw - FLOW_WIDTH) / 2),
          Math.round(my + (mh - windowH) / 2),
        ),
      )
    }
  } catch {}
}
