import { emit } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useUiStore } from "@/store/workspace"
import { ImportRequestsModal } from "./ImportRequestsModal"
import { McpModal } from "./McpBridge/McpModal"
import { McpStatusItem } from "./McpBridge/McpStatusItem"

async function openSettingsSection(section: "keyboard") {
  const existing = await WebviewWindow.getByLabel("settings").catch(() => null)
  if (existing) {
    await existing.show().catch(() => {})
    await existing.setFocus().catch(() => {})
    await emit("settings:goto-section", { section }).catch(() => {})
    return
  }
  // Fresh window — pass the section via URL so the panel renders correctly
  // before any event has a chance to fire.
  new WebviewWindow("settings", {
    url: `/?section=${section}`,
    title: "Settings",
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    resizable: true,
  })
}

export function PreferencesButton() {
  const [showMcp, setShowMcp] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const activeTool = useUiStore((s) => s.activeTool)
  const panelLayout = useUiStore((s) => s.panelLayout)
  const togglePanelLayout = useUiStore((s) => s.togglePanelLayout)

  useKeydown(SHORTCUTS.SHOW_SHORTCUTS, () => {
    void openSettingsSection("keyboard")
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
              <span className="ml-auto font-mono text-[0.714rem] tracking-[0.2em] text-muted">
                {formatKeyCombo(SHORTCUTS.TOGGLE_LAYOUT)}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"
            onClick={() => {
              void openSettingsSection("keyboard")
            }}
          >
            <Glyph kind="keyboard" size={13} color="var(--base04)" />
            Keyboard Shortcuts
            <span className="ml-auto font-mono text-[0.714rem] tracking-[0.2em] text-muted">
              {formatKeyCombo(SHORTCUTS.SHOW_SHORTCUTS)}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
