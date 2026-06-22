import type React from "react"
import { SHORTCUTS } from "@/config/shortcuts"
import { matchesCombo } from "@/hooks/useKeydown"
import { useRequestActions } from "@/plugins/hooks"
import { useRequestStore } from "@/store/requests"
import { pasteFromClipboard } from "./pasteRequest"
import type { useKeyNav } from "./useKeyNav"

type KeyNav = ReturnType<typeof useKeyNav>

/** The tree's keydown pipeline: copy-as-cURL, paste-as-request, delete, then
 * arrow/Enter navigation. Returns a single handler for the container; each
 * custom step bails (returns false) so the next gets a chance, and native
 * copy/paste still runs when there's a text selection. */
export function useTreeKeyboard({
  workspaceId,
  keyNav,
  renamingId,
  onDeleteIds,
}: {
  workspaceId: string
  keyNav: KeyNav
  renamingId: string | null
  onDeleteIds?: (ids: string[]) => void
}): (e: React.KeyboardEvent) => void {
  const requestActions = useRequestActions()

  // Cmd/Ctrl+C on a focused request copies it as cURL — but only with no text
  // selection, so highlighted text still copies natively.
  function handleCopyAsCurl(e: React.KeyboardEvent): boolean {
    if (!matchesCombo(e, SHORTCUTS.COPY_AS_CURL)) return false
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return false
    if (!keyNav.focusedId) return false
    const req = useRequestStore
      .getState()
      .requests.find((r) => r.id === keyNav.focusedId)
    if (!req) return false // focused node is a folder
    const action = requestActions.find((a) => a.id === "copy-as-curl")
    if (!action) return false
    e.preventDefault()
    e.stopPropagation()
    void action.onInvoke(req)
    return true
  }

  // Delete / Backspace removes every selected row. The confirm modal lives in
  // the consumer (RequestTreePane); we just hand off the id list.
  function handleDeleteSelection(e: React.KeyboardEvent): boolean {
    if (e.key !== "Delete" && e.key !== "Backspace") return false
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (keyNav.selectedIds.length === 0 || !onDeleteIds) return false
    e.preventDefault()
    e.stopPropagation()
    onDeleteIds(keyNav.selectedIds)
    return true
  }

  // Cmd/Ctrl+V pastes a cURL/HTTPie command as a new request, targeting the
  // focused folder, the focused request's folder, or root. Same selection guard
  // as copy so native paste still runs in text fields.
  function handlePasteRequest(e: React.KeyboardEvent): boolean {
    if (!matchesCombo(e, SHORTCUTS.PASTE_REQUEST)) return false
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return false
    e.preventDefault()
    e.stopPropagation()
    void pasteFromClipboard(workspaceId, keyNav.focusedId)
    return true
  }

  return (e: React.KeyboardEvent) => {
    // Don't steal keys while an inline rename input is active.
    if (renamingId) return
    if (handleCopyAsCurl(e)) return
    if (handlePasteRequest(e)) return
    if (handleDeleteSelection(e)) return
    keyNav.handleKeyDown(e)
  }
}
