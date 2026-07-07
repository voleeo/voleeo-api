import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { CookieJarSwitcher } from "@/layout/CookieJarSwitcher"
import { EnvironmentSwitcher } from "@/layout/EnvironmentSwitcher"
import { NewItemButton } from "@/layout/NewItemButton"
import { PreferencesButton } from "@/layout/PreferencesButton"
import { SourceControlMenu } from "@/layout/SourceControlMenu"
import { WindowControls } from "@/layout/WindowControls"
import { WorkspaceSwitcher } from "@/layout/WorkspaceSwitcher"
import { isLinux, isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { useChromeStore } from "@/store/chrome"
import { useEnvironmentStore } from "@/store/environment"
import {
  selectActiveConnection,
  selectActiveFolder,
  selectActiveGrpc,
  selectActiveRequest,
  useRequestStore,
} from "@/store/requests"
import { useUiStore } from "@/store/workspace"

const APP_NAME = "Voleeo"

function SidebarToggleButton() {
  const treeVisible = useUiStore((s) => s.treeVisible)
  const toggleTreeVisible = useUiStore((s) => s.toggleTreeVisible)
  useKeydown(SHORTCUTS.TOGGLE_TREE, toggleTreeVisible)
  return (
    <button
      type="button"
      title={`${treeVisible ? "Hide" : "Show"} sidebar (${formatKeyCombo(SHORTCUTS.TOGGLE_TREE)})`}
      onClick={toggleTreeVisible}
      className={cn(
        "flex items-center justify-center w-7 h-7 rounded-[5px] cursor-pointer bg-transparent border-0 outline-none hover:bg-subtle",
        !treeVisible && "opacity-50",
      )}
    >
      <Glyph kind="sidebar" size={14} color="var(--base04)" />
    </button>
  )
}

export function TopBar() {
  const { activeTool, activeWorkspaceId, workspaces } = useUiStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      activeWorkspaceId: s.activeWorkspaceId,
      workspaces: s.workspaces,
    })),
  )
  const activeRequest = useRequestStore(selectActiveRequest)
  const activeFolder = useRequestStore(selectActiveFolder)
  const activeConnection = useRequestStore(selectActiveConnection)
  const activeGrpc = useRequestStore(selectActiveGrpc)
  const activeEnvColor = useEnvironmentStore((s) => {
    const env = s.environments.find((e) => e.id === s.activeEnvId)
    return env?.color ?? null
  })
  const customTitleBar = useChromeStore((s) => s.customTitleBar)
  const macTitleBar = customTitleBar && isMac
  const linuxControls = customTitleBar && isLinux
  const customBar = macTitleBar || linuxControls

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const showSwitcher = activeTool !== "welcome" && activeWorkspace !== null

  const activeApiItemName =
    activeFolder?.name ??
    activeConnection?.name ??
    activeGrpc?.name ??
    activeRequest?.name ??
    null
  const centerLabel =
    activeTool === "git"
      ? "Git Sync"
      : activeTool === "api" && activeApiItemName
        ? activeApiItemName
        : APP_NAME

  useEffect(() => {
    getCurrentWindow()
      .setTitle(activeWorkspace?.name ?? APP_NAME)
      .catch(() => {})
  }, [activeWorkspace])

  return (
    <header
      className="relative flex items-center bg-surface border-b border-border select-none"
      style={{
        height: "var(--topbar-height)",
        paddingLeft: macTitleBar ? "var(--traffic-lights-width)" : 12,
        paddingRight: linuxControls ? "var(--window-controls-width)" : 12,
      }}
      data-tauri-drag-region={customBar ? "" : undefined}
    >
      {showSwitcher && activeEnvColor && (
        <div
          className="absolute bottom-0 right-0 w-1/3 h-px pointer-events-none"
          style={{
            background: `linear-gradient(to left, ${activeEnvColor}, transparent)`,
          }}
        />
      )}
      {/* Left — new item + workspace switcher */}
      <div className="flex items-center gap-1 h-full">
        {showSwitcher && (
          <>
            <SidebarToggleButton />
            <NewItemButton />
            <WorkspaceSwitcher
              activeWorkspace={activeWorkspace}
              activeWorkspaceId={activeWorkspace.id}
            />
          </>
        )}
      </div>

      {customBar && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="font-sans text-[0.929rem] text-muted truncate max-w-[320px] block text-center">
            {centerLabel}
          </span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        {showSwitcher && activeTool === "api" && activeWorkspaceId && (
          <>
            <EnvironmentSwitcher workspaceId={activeWorkspaceId} />
            <CookieJarSwitcher workspaceId={activeWorkspaceId} />
          </>
        )}
        {showSwitcher && activeWorkspaceId && <SourceControlMenu />}
        {activeTool !== "welcome" && <PreferencesButton />}
      </div>

      {linuxControls && <WindowControls />}
    </header>
  )
}
