import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { EVENTS } from "@/config/events"
import { useInterfaceStore } from "@/store/interface"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../packages/types/bindings"
import { openExportWindow } from "./exportWindow"
import { openSettingsWindow } from "./settingsWindow"

// Interface font-size bounds, shared with Settings → Interface.
const FONT_MIN = 8
const FONT_MAX = 22
const FONT_DEFAULT = 14

function zoom(delta: number) {
  const s = useInterfaceStore.getState()
  s.setFontSize(Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + delta)))
}

// The focused folder to create into — mirrors NewItemButton.resolveTargetFolderId.
function targetFolderId(): string | undefined {
  const focusedId = useTreeUiStore.getState().focusedNodeId
  if (!focusedId) return undefined
  const { folders, requests } = useRequestStore.getState()
  if (folders.some((f) => f.id === focusedId)) {
    useTreeUiStore.getState().ensureFoldersOpen([focusedId])
    return focusedId
  }
  return requests.find((r) => r.id === focusedId)?.folderId ?? undefined
}

type Creator = (
  workspaceId: string,
  opts?: { folderId?: string },
) => Promise<{ id: string } | null>

// Create a tree item into the focused folder and queue it for rename — the
// same flow the "+" button uses.
async function createItem(create: Creator) {
  const ws = useUiStore.getState().activeWorkspaceId
  if (!ws) return
  const folderId = targetFolderId()
  const created = await create(ws, folderId ? { folderId } : undefined)
  if (created) useTreeUiStore.getState().focusNewItem(created.id)
}

/** Native-menu item id → action. Runs in the focused window (see menu.rs). */
const ACTIONS: Record<string, () => void> = {
  new_request: () => void createItem(useRequestStore.getState().createRequest),
  new_graphql: () =>
    void createItem(useRequestStore.getState().createGraphqlRequest),
  new_websocket: () =>
    void createItem(useRequestStore.getState().createConnection),
  new_grpc: () => void createItem(useRequestStore.getState().createGrpc),
  new_folder: () => void createItem(useRequestStore.getState().createFolder),
  import: () => useUiStore.getState().setImportOpen(true),
  export: () => void openExportWindow(useUiStore.getState().activeWorkspaceId),
  zoom_in: () => zoom(1),
  zoom_out: () => zoom(-1),
  zoom_reset: () => useInterfaceStore.getState().setFontSize(FONT_DEFAULT),
  toggle_sidebar: () => useUiStore.getState().toggleTreeVisible(),
  toggle_layout: () => useUiStore.getState().togglePanelLayout(),
  show_shortcuts: () => void openSettingsWindow("keyboard"),
}

/** Run a menu action by id — also used by the Windows/Linux keydown fallback. */
export function runMenuAction(id: string) {
  ACTIONS[id]?.()
}

/** Subscribe this window to `menu:action`; call once per window from main.tsx. */
export function initMenuActions() {
  void listen<string>(EVENTS.menuAction, (e) => runMenuAction(e.payload)).catch(
    () => {},
  )

  // The File menu's workspace-scoped items (New Request, Import, Export) only
  // work with a workspace open. The main window drives their enabled state on
  // the global macOS menu; other windows leave it alone.
  if (getCurrentWebviewWindow().label !== "main") return
  const sync = (id: string | null) =>
    void commands.setWorkspaceMenuEnabled(!!id)
  sync(useUiStore.getState().activeWorkspaceId)
  useUiStore.subscribe((s, prev) => {
    if (!!s.activeWorkspaceId !== !!prev.activeWorkspaceId)
      sync(s.activeWorkspaceId)
  })
}
