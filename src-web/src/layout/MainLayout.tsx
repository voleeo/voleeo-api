import { CommandPalette } from "@/layout/CommandPalette"
import { Toast } from "@/layout/Toast"
import { ToolViewport } from "@/layout/ToolViewport"
import { TopBar } from "@/layout/TopBar"
import { useUiStore } from "@/store/workspace"

export function MainLayout() {
  const activeTool = useUiStore((s) => s.activeTool)

  return (
    <div
      className="grid h-screen"
      style={{ gridTemplateRows: "var(--topbar-height) 1fr" }}
    >
      <TopBar />
      <div className="overflow-hidden h-full">
        <ToolViewport activeTool={activeTool} />
      </div>
      <CommandPalette />
      <Toast />
    </div>
  )
}
