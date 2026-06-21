import { isMac } from "@/lib/platform"
import { useChromeStore } from "@/store/chrome"

export function WelcomeTitleBar() {
  const customTitleBar = useChromeStore((s) => s.customTitleBar)

  // This strip only backs the macOS overlay titlebar (traffic-light room + drag region).
  // Windows/Linux have a native titlebar, so rendering it there just adds dead space above the content.
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
