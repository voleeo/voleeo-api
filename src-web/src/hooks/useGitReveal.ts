import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { EVENTS } from "@/config/events"
import type { GitRevealPayload } from "@/store/gitReview"
import { useRequestStore } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { useUiStore } from "@/store/workspace"
import { revealInTree } from "@/views/ApiWorkspace/revealInTree"

type TreeReveal = "request" | "websocket" | "grpc" | "folder"

function revealTreeNode(type: TreeReveal, nodeId: string) {
  const rs = useRequestStore.getState()
  const from =
    type === "folder"
      ? nodeId
      : type === "request"
        ? (rs.requests.find((r) => r.id === nodeId)?.folderId ?? null)
        : type === "grpc"
          ? (rs.grpcRequests.find((g) => g.id === nodeId)?.folderId ?? null)
          : (rs.connections.find((c) => c.id === nodeId)?.folderId ?? null)

  revealInTree(nodeId, from, rs.folders)

  if (type === "request") rs.setActiveRequest(nodeId)
  else if (type === "grpc") rs.setActiveGrpc(nodeId)
  else if (type === "websocket") rs.setActiveConnection(nodeId)
  else rs.setActiveFolder(nodeId)
}

function handleReveal({ workspaceId, type, nodeId }: GitRevealPayload) {
  const ui = useUiStore.getState()
  const switching = ui.activeWorkspaceId !== workspaceId

  if (
    type === "request" ||
    type === "folder" ||
    type === "grpc" ||
    type === "websocket"
  ) {
    if (switching) ui.openWorkspace(workspaceId, "api")
    else ui.setActiveTool("api")
    if (nodeId) revealTreeNode(type, nodeId)
    return
  }
  if (type === "snapshot") {
    if (switching) ui.openWorkspace(workspaceId, "api")
    else ui.setActiveTool("api")
    if (nodeId)
      void useSnapshotsStore.getState().revealSnapshot(workspaceId, nodeId)
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
