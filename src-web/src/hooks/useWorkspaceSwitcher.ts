import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow"
import { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useInterfaceStore } from "@/store/interface"
import { useUiStore, type Workspace } from "@/store/workspace"

export function openInNewWindow(w: Workspace) {
  const win = new WebviewWindow(`ws-${w.id}`, {
    url: `index.html?workspaceId=${w.id}`,
    title: w.name,
    width: 1280,
    height: 800,
  })
  win.once("tauri://error", (e) => console.error("new window failed:", e))
}

/**
 * Encapsulates workspace-switching logic shared by WorkspaceSwitcher and CommandPalette.
 *
 * Handles:
 *  - Skipping if already the active workspace
 *  - Focusing an existing window when the workspace is already open elsewhere
 *  - "current" / "new" / "ask" behavior modes
 *
 * Returns `pendingWorkspace` when behavior is "ask" — caller must render
 * <WorkspaceSwitchModal> to let the user pick This Window vs New Window.
 */
export function useWorkspaceSwitcher() {
  const [pendingWorkspace, setPendingWorkspace] = useState<Workspace | null>(
    null,
  )
  const { activeWorkspaceId, openWorkspace, workspaceWindowMap } = useUiStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      openWorkspace: s.openWorkspace,
      workspaceWindowMap: s.workspaceWindowMap,
    })),
  )
  const workspaceBehavior = useInterfaceStore((s) => s.workspaceBehavior)

  async function handleSwitch(w: Workspace) {
    if (w.id === activeWorkspaceId) return

    // If this workspace is already open in *another* window, focus it instead.
    // We compare against the current window's label to ignore stale map entries
    // left over from in-window workspace switches (the map is append-only).
    const currentLabel = getCurrentWebviewWindow().label
    const mappedLabel = workspaceWindowMap[w.id]
    if (mappedLabel && mappedLabel !== currentLabel) {
      const existing = await WebviewWindow.getByLabel(mappedLabel).catch(
        () => null,
      )
      if (existing) {
        existing.show().catch(() => {})
        existing.setFocus().catch(() => {})
        return
      }
    }

    if (workspaceBehavior === "current") {
      openWorkspace(w.id)
    } else if (workspaceBehavior === "new") {
      openInNewWindow(w)
    } else {
      // "ask" — surface the picker modal
      setPendingWorkspace(w)
    }
  }

  function confirmCurrentWindow() {
    if (!pendingWorkspace) return
    openWorkspace(pendingWorkspace.id)
    setPendingWorkspace(null)
  }

  function confirmNewWindow() {
    if (!pendingWorkspace) return
    openInNewWindow(pendingWorkspace)
    setPendingWorkspace(null)
  }

  function cancelPending() {
    setPendingWorkspace(null)
  }

  return {
    handleSwitch,
    pendingWorkspace,
    confirmCurrentWindow,
    confirmNewWindow,
    cancelPending,
  }
}
