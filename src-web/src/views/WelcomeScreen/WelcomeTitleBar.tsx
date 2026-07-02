import { WindowControls } from "@/layout/WindowControls"
import { isLinux, isMac } from "@/lib/platform"
import { useChromeStore } from "@/store/chrome"

export function WelcomeTitleBar() {
  const customTitleBar = useChromeStore((s) => s.customTitleBar)

  if (isLinux && customTitleBar) {
    return (
      <div
        className="relative"
        style={{ height: "var(--topbar-height)" }}
        data-tauri-drag-region=""
      >
        <WindowControls showMaximize={false} />
      </div>
    )
  }

  if (!isMac || !customTitleBar) return null
  return (
    <div
      style={{
        height: "var(--topbar-height)",
        paddingLeft: "var(--traffic-lights-width)",
      }}
      data-tauri-drag-region=""
    />
  )
}
