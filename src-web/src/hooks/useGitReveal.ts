import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { getAncestorFolderIds } from "@/components/ApiRequestTree/treeUtils"
import { GIT_REVEAL_EVENT, type GitRevealPayload } from "@/store/gitReview"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"

/** Expand the node's ancestor folders and select it in the request tree. */
function revealTreeNode(type: "request" | "folder", nodeId: string) {
  const rs = useRequestStore.getState()
  const parent =
    type === "request"
      ? (rs.requests.find((r) => r.id === nodeId)?.folderId ?? null)
      : (rs.folders.find((f) => f.id === nodeId)?.folderId ?? null)
  const open = getAncestorFolderIds(rs.folders, parent)
  if (type === "folder") open.push(nodeId) // also expand the folder itself
  const tree = useTreeUiStore.getState()
  tree.ensureFoldersOpen(open)
  // Match a manual click: focus + select the row so it gets the highlight bg.
  tree.setFocusedNodeId(nodeId)
  tree.setSelection([nodeId], nodeId)
  if (type === "request") rs.setActiveRequest(nodeId)
  else rs.setActiveFolder(nodeId)
}

/** Open the clicked Git Sync entity in the right surface of the main window. */
function handleReveal({ workspaceId, type, nodeId }: GitRevealPayload) {
  const ui = useUiStore.getState()
  const switching = ui.activeWorkspaceId !== workspaceId

  if (type === "request" || type === "folder") {
    if (switching) ui.openWorkspace(workspaceId, "api")
    else ui.setActiveTool("api")
    if (nodeId) revealTreeNode(type, nodeId)
    return
  }
  if (switching) ui.openWorkspace(workspaceId)
  if (type === "cookie") ui.requestCookies(nodeId)
  else if (type === "environment") ui.requestEnvironments(nodeId)
  else if (type === "workspace") ui.requestWorkspaceSettings("workspace")
}

/** Listen for the Git Sync window's reveal requests and open the entity here.
 * Only the main window should react, so callers pass `enabled` accordingly. */
export function useGitReveal(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const p = listen<GitRevealPayload>(GIT_REVEAL_EVENT, ({ payload }) =>
      handleReveal(payload),
    )
    return () => {
      p.then((f) => f())
    }
  }, [enabled])
}
