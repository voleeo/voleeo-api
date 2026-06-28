import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { getAncestorFolderIds } from "@/components/ApiRequestTree/treeUtils"
import { EVENTS } from "@/config/events"
import type { GitRevealPayload } from "@/store/gitReview"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"

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
  tree.setFocusedNodeId(nodeId)
  tree.setSelection([nodeId], nodeId)
  if (type === "request") rs.setActiveRequest(nodeId)
  else rs.setActiveFolder(nodeId)
}

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

export function useGitReveal(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const p = listen<GitRevealPayload>(EVENTS.gitReveal, ({ payload }) =>
      handleReveal(payload),
    )
    return () => {
      p.then((f) => f())
    }
  }, [enabled])
}
