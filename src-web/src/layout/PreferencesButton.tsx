import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useUpdateStore } from "@/store/update"
import { useUiStore } from "@/store/workspace"
import { openExportWindow } from "./exportWindow"
import { ImportRequestsModal } from "./ImportRequestsModal"
import { McpModal } from "./McpBridge/McpModal"
import { McpStatusItem } from "./McpBridge/McpStatusItem"
import { openSettingsWindow } from "./settingsWindow"

export function PreferencesButton() {
  const [showMcp, setShowMcp] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const activeTool = useUiStore((s) => s.activeTool)
  const panelLayout = useUiStore((s) => s.panelLayout)
  const togglePanelLayout = useUiStore((s) => s.togglePanelLayout)

  useKeydown(SHORTCUTS.SHOW_SHORTCUTS, () => {
    void openSettingsWindow("keyboard")
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="Preferences"
          className="flex items-center justify-center w-7 h-7 rounded-[5px] cursor-pointer bg-transparent border-0 outline-none hover:bg-subtle data-[popup-open]:bg-subtle"
        >
          <Glyph kind="settings" size={14} color="var(--base04)" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[210px]">
          <DropdownMenuItem
            className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
            onClick={() => setShowImport(true)}
          >
            <Glyph kind="import" size={13} color="var(--base04)" />
            Import
          </DropdownMenuItem>
          <DropdownMenuItem
            className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
            onClick={() =>
              void openExportWindow(useUiStore.getState().activeWorkspaceId)
            }
          >
            <Glyph kind="upload-simple" size={13} color="var(--base04)" />
            Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {activeTool === "api" && (
            <DropdownMenuItem
              className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
              onClick={togglePanelLayout}
            >
              <Glyph
                kind={panelLayout === "columns" ? "rows" : "columns"}
                size={13}
                color="var(--base04)"
              />
              Switch to {panelLayout === "columns" ? "Rows" : "Columns"} Layout
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
            onClick={() => {
              void openSettingsWindow("keyboard")
            }}
          >
            <Glyph kind="keyboard" size={13} color="var(--base04)" />
            Keyboard Shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
            onClick={() => void useUpdateStore.getState().check()}
          >
            <Glyph kind="refresh" size={13} color="var(--base04)" />
            Check for Updates
          </DropdownMenuItem>
          <McpStatusItem onOpen={() => setShowMcp(true)} />
        </DropdownMenuContent>
      </DropdownMenu>

      {showMcp && <McpModal onClose={() => setShowMcp(false)} />}
      {showImport && (
        <ImportRequestsModal onClose={() => setShowImport(false)} />
      )}
    </>
  )
}
