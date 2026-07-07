import { emit } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { PluginPromptHost } from "@/components/PluginPromptHost"
import { EVENTS } from "@/config/events"
import { useDisableNativeAutofill } from "@/hooks/useDisableNativeAutofill"
import { useGitReveal } from "@/hooks/useGitReveal"
import { useGrpcSync } from "@/hooks/useGrpcSync"
import { useMcpSync } from "@/hooks/useMcpSync"
import { useSseSync } from "@/hooks/useSseSync"
import { useWsSync } from "@/hooks/useWsSync"
import { MainLayout } from "@/layout/MainLayout"
import { StartupParamsSchema } from "@/lib/schemas"
import { loadAllSettings } from "@/lib/workspaceSettings"
import { SettingsWindow } from "@/settings/SettingsWindow"
import { useChromeStore } from "@/store/chrome"
import { useThemeStore } from "@/store/theme"
import { useUiStore } from "@/store/workspace"
import { ExportWindow } from "@/views/Export"
import { GitWindow } from "@/views/GitSync/GitWindow"

interface TauriWindow {
  __TAURI_INTERNALS__?: {
    metadata?: { currentWindow?: { label?: string } }
  }
}

function getWindowLabel(): string {
  try {
    return (
      (window as unknown as TauriWindow).__TAURI_INTERNALS__?.metadata
        ?.currentWindow?.label ?? "main"
    )
  } catch {
    return "main"
  }
}

const windowLabel = getWindowLabel()
const isGitWindow = windowLabel.startsWith("git-")
const isExportWindow = windowLabel === "export"
const _sp = new URLSearchParams(window.location.search)
const { workspaceId: startWorkspaceId } = StartupParamsSchema.parse({
  workspaceId: _sp.get("workspaceId"),
})

export default function App() {
  const initialize = useThemeStore((s) => s.initialize)
  const openWorkspace = useUiStore((s) => s.openWorkspace)
  const initChrome = useChromeStore((s) => s.init)

  useMcpSync()
  useWsSync()
  useGrpcSync()
  useSseSync()
  useGitReveal(windowLabel === "main")
  useDisableNativeAutofill()

  useEffect(() => {
    let cleanup: (() => void) | undefined
    initialize().then((fn) => {
      cleanup = fn
    })
    if (windowLabel === "main") initChrome()
    return () => cleanup?.()
  }, [initialize, initChrome])

  useEffect(() => {
    // Tell all other windows we just opened so they re-broadcast their workspace mappings
    emit(EVENTS.workspaceAnnounce, {}).catch(() => {})
    // The git window does its own focused bootstrap (no tool/resize side effects).
    if (startWorkspaceId && !isGitWindow && !isExportWindow) {
      // Load persisted settings into cache before openWorkspace reads them.
      // Without this, secondary/deep-link windows call openWorkspace with an
      // empty cache and silently lose panel layout, schema side, and window size.
      loadAllSettings().then(() => openWorkspace(startWorkspaceId))
    }
  }, [openWorkspace])

  if (windowLabel === "settings") {
    return (
      <>
        <SettingsWindow />
        <PluginPromptHost />
      </>
    )
  }

  if (windowLabel === "export") {
    return (
      <>
        <div className="h-screen bg-bg text-fg">
          <ExportWindow />
        </div>
        <PluginPromptHost />
      </>
    )
  }

  if (isGitWindow) {
    return (
      <>
        <GitWindow workspaceId={startWorkspaceId} />
        <PluginPromptHost />
      </>
    )
  }

  return (
    <>
      <MainLayout />
      <PluginPromptHost />
    </>
  )
}
