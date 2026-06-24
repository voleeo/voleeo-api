import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window"
import { isWindows } from "@/lib/platform"
import { useChromeStore } from "@/store/chrome"

export const FLOW_WIDTH = 900
const MIN_HEIGHT = 280

export async function applyFlowWindowHeight(height: number) {
  try {
    const win = getCurrentWebviewWindow()
    const monitor = await currentMonitor()
    const topChrome =
      !isWindows && useChromeStore.getState().customTitleBar ? 40 : 0
    const maxH = monitor
      ? Math.floor(monitor.size.height / monitor.scaleFactor) - 80
      : 900
    const contentH = Math.max(MIN_HEIGHT, Math.min(height, maxH - topChrome))
    const windowH = contentH + topChrome
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
