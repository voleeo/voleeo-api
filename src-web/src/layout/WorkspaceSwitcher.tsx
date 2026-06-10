import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher"
import { WorkspaceSwitchModal } from "@/layout/WorkspaceSwitchModal"
import { getCachedSettings } from "@/lib/workspaceSettings"
import type { Workspace, WorkspaceSettingsSection } from "@/store/workspace"
import { useUiStore } from "@/store/workspace"
import { WorkspaceSettingsModal } from "@/views/WorkspaceSettingsModal"
import { commands } from "../../../packages/types/bindings"
import { ITEM } from "./gitMenu"

interface Props {
  activeWorkspace: Workspace
  activeWorkspaceId: string
}

export function WorkspaceSwitcher({
  activeWorkspace,
  activeWorkspaceId,
}: Props) {
  const {
    workspaces,
    loadWorkspaces,
    openWorkspace,
    setActiveTool,
    pendingSettingsSection,
    pendingSettingsFocusKey,
    clearPendingSettings,
  } = useUiStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      loadWorkspaces: s.loadWorkspaces,
      openWorkspace: s.openWorkspace,
      setActiveTool: s.setActiveTool,
      pendingSettingsSection: s.pendingSettingsSection,
      pendingSettingsFocusKey: s.pendingSettingsFocusKey,
      clearPendingSettings: s.clearPendingSettings,
    })),
  )
  const {
    handleSwitch,
    pendingWorkspace,
    confirmCurrentWindow,
    confirmNewWindow,
    cancelPending,
  } = useWorkspaceSwitcher()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] =
    useState<WorkspaceSettingsSection>("workspace")
  const [settingsFocusKey, setSettingsFocusKey] = useState<string | undefined>(
    undefined,
  )

  // React to requestWorkspaceSettings() calls from anywhere in the app.
  useEffect(() => {
    if (!pendingSettingsSection) return
    setSettingsSection(pendingSettingsSection)
    setSettingsFocusKey(pendingSettingsFocusKey ?? undefined)
    setSettingsOpen(true)
    clearPendingSettings()
  }, [pendingSettingsSection, pendingSettingsFocusKey, clearPendingSettings])

  function openSettings(section: WorkspaceSettingsSection = "workspace") {
    setSettingsSection(section)
    setSettingsFocusKey(undefined)
    setSettingsOpen(true)
  }

  async function handleOpenFolder() {
    const selected = await open({ directory: true, multiple: false })
    if (!selected) return
    const folderPath = typeof selected === "string" ? selected : selected[0]
    const res = await commands.workspaceOpenFolder(folderPath).catch(() => null)
    if (!res || res.status !== "ok") return
    await loadWorkspaces()
    openWorkspace(res.data.id, "api")
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) loadWorkspaces()
        }}
      >
        <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1 rounded-[5px] cursor-pointer bg-transparent border-0 outline-none hover:bg-subtle data-[popup-open]:bg-subtle">
          <span className="font-sans text-[0.929rem] font-medium text-fg">
            {activeWorkspace.name}
          </span>
          <Glyph kind="chevron-down" size={13} color="var(--base04)" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-[230px]">
          <DropdownMenuItem
            className={ITEM}
            onClick={() => setActiveTool("welcome")}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            Create Workspace
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onClick={handleOpenFolder}>
            <Glyph kind="import" size={13} color="var(--base04)" />
            Open
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {[...workspaces]
            .sort((a, b) => {
              const aKey = getCachedSettings(a.id).openedAt || a.updatedAt
              const bKey = getCachedSettings(b.id).openedAt || b.updatedAt
              return bKey.localeCompare(aKey)
            })
            .map((w) => {
              const isActive = w.id === activeWorkspaceId
              return (
                <DropdownMenuItem
                  key={w.id}
                  className={ITEM}
                  onClick={() => handleSwitch(w)}
                >
                  <span className="w-3.5 inline-flex justify-center shrink-0">
                    {isActive && (
                      <Glyph kind="check" size={13} color="var(--base0B)" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                </DropdownMenuItem>
              )
            })}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={ITEM} onClick={() => openSettings()}>
            <Glyph kind="settings" size={13} color="var(--base04)" />
            Workspace Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {settingsOpen && (
        <WorkspaceSettingsModal
          initialSection={settingsSection}
          initialFocusKey={settingsFocusKey}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {pendingWorkspace && (
        <WorkspaceSwitchModal
          workspace={pendingWorkspace}
          onCurrentWindow={confirmCurrentWindow}
          onNewWindow={confirmNewWindow}
          onCancel={cancelPending}
        />
      )}
    </>
  )
}
