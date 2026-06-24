import { WindowControls } from "@/layout/WindowControls"
import { isLinux, isMac } from "@/lib/platform"
import { useChromeStore } from "@/store/chrome"

export function WelcomeTitleBar() {
  const customTitleBar = useChromeStore((s) => s.customTitleBar)

  // Linux: decorations are stripped (see window_chrome.rs), so the welcome screen
  // needs its own drag strip + window controls to stay movable.
  if (isLinux) {
    return (
      <div
        className="relative bg-bg"
        style={{ height: "var(--topbar-height)" }}
        data-tauri-drag-region=""
      >
        <WindowControls />
      </div>
    )
  }

  // macOS: a strip backing the overlay titlebar (traffic-light room + drag region).
  // Windows keeps its native title bar, so nothing here.
  if (!isMac || !customTitleBar) return null
  return (
    <div
      className="bg-bg"
      style={{
        height: "var(--topbar-height)",
        paddingLeft: "var(--traffic-lights-width)",
      }}
      data-tauri-drag-region=""
    />
  )
}
