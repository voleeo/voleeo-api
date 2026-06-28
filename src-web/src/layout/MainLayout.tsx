import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect } from "react"
import { EVENTS } from "@/config/events"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { CommandPalette } from "@/layout/CommandPalette"
import { Toast } from "@/layout/Toast"
import { ToolViewport } from "@/layout/ToolViewport"
import { TopBar } from "@/layout/TopBar"
import { UpdateBanner } from "@/layout/UpdateBanner"
import { isMac } from "@/lib/platform"
import { type ToastKind, useToastStore } from "@/store/toast"
import {
  getAutoUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  useUpdateStore,
} from "@/store/update"
import { useUiStore } from "@/store/workspace"
import { WelcomeTitleBar } from "@/views/WelcomeScreen/WelcomeTitleBar"
import { openSettingsWindow } from "./settingsWindow"

export function MainLayout() {
  const activeTool = useUiStore((s) => s.activeTool)

  useEffect(() => {
    // Skip background checks when the user turned auto-update off; they can
    // still trigger one manually from Settings → General → Check now. The
    // preference lives in settings.json, so read it fresh each tick.
    const tick = async () => {
      if (await getAutoUpdate())
        void useUpdateStore.getState().check({ silent: true })
    }
    void tick()
    const id = setInterval(() => void tick(), UPDATE_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const unlisten = listen<{ message: string; kind: ToastKind }>(
      EVENTS.exportToast,
      (e) =>
        useToastStore.getState().show(e.payload.message, 3500, e.payload.kind),
    )
    return () => void unlisten.then((un) => un())
  }, [])

  const openSettings = useCallback(() => void openSettingsWindow(), [])
  useKeydown(SHORTCUTS.SETTINGS, openSettings, !isMac)

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
