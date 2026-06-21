import { useEffect } from "react"
import { CommandPalette } from "@/layout/CommandPalette"
import { Toast } from "@/layout/Toast"
import { ToolViewport } from "@/layout/ToolViewport"
import { TopBar } from "@/layout/TopBar"
import { UpdateBanner } from "@/layout/UpdateBanner"
import { UPDATE_CHECK_INTERVAL_MS, useUpdateStore } from "@/store/update"
import { useUiStore } from "@/store/workspace"
import { WelcomeTitleBar } from "@/views/WelcomeScreen/WelcomeTitleBar"

export function MainLayout() {
  const activeTool = useUiStore((s) => s.activeTool)

  useEffect(() => {
    const tick = () => void useUpdateStore.getState().check({ silent: true })
    tick()
    const id = setInterval(tick, UPDATE_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col h-screen">
      {activeTool === "welcome" ? <WelcomeTitleBar /> : <TopBar />}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ToolViewport activeTool={activeTool} />
      </div>
      <CommandPalette />
      <UpdateBanner />
      <Toast />
    </div>
  )
}
