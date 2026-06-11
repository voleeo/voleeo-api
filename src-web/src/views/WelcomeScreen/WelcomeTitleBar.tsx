import { useChromeStore } from "@/store/chrome"

export function WelcomeTitleBar() {
  const customTitleBar = useChromeStore((s) => s.customTitleBar)
  return (
    <div
      className="bg-bg"
      style={{
        height: "var(--topbar-height)",
        paddingLeft: customTitleBar ? "var(--traffic-lights-width)" : 12,
      }}
      data-tauri-drag-region={customTitleBar ? "" : undefined}
    />
  )
}
