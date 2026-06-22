import { useCallback, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import {
  getAncestorFolderIds,
  getFolderPath,
} from "@/components/ApiRequestTree/treeUtils"
import { C_GQL, C_GRPC, C_WS, methodColor } from "@/components/tokens"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"

export interface RecentItem {
  id: string
  badge: string
  badgeColor: string
  name: string
  folderPath: string
  active: boolean
  onSelect: () => void
}

export function usePalette() {
  const [open, setOpen] = useState(false)
  const {
    workspaces,
    activeWorkspaceId,
    activeTool,
    setActiveTool,
    loadWorkspaces,
  } = useUiStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      activeWorkspaceId: s.activeWorkspaceId,
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      loadWorkspaces: s.loadWorkspaces,
    })),
  )
  const {
    createRequest,
    createGraphqlRequest,
    createConnection,
    createGrpc,
    createFolder,
    requests,
    connections,
    grpcRequests,
    folders,
    activeRequestId,
    activeConnectionId,
    activeGrpcId,
    recentNodeIds,
    setActiveRequest,
    setActiveConnection,
    setActiveGrpc,
  } = useRequestStore(
    useShallow((s) => ({
      createRequest: s.createRequest,
      createGraphqlRequest: s.createGraphqlRequest,
      createConnection: s.createConnection,
      createGrpc: s.createGrpc,
      createFolder: s.createFolder,
      requests: s.requests,
      connections: s.connections,
      grpcRequests: s.grpcRequests,
      folders: s.folders,
      activeRequestId: s.activeRequestId,
      activeConnectionId: s.activeConnectionId,
      activeGrpcId: s.activeGrpcId,
      recentNodeIds: s.recentNodeIds,
      setActiveRequest: s.setActiveRequest,
      setActiveConnection: s.setActiveConnection,
      setActiveGrpc: s.setActiveGrpc,
    })),
  )
  const switcher = useWorkspaceSwitcher()

  const workspaceOpen = activeWorkspaceId !== null && activeTool !== "welcome"

  const openPalette = useCallback(() => {
    loadWorkspaces()
    setOpen(true)
  }, [loadWorkspaces])
  useKeydown(SHORTCUTS.COMMAND_PALETTE, openPalette, workspaceOpen)

  const close = useCallback(() => setOpen(false), [])

  // Focus (highlight + scroll-to + rename) the freshly created item in the tree.
  const focusCreated = (id: string | undefined) => {
    if (id) useTreeUiStore.getState().focusNewItem(id)
  }
  const createWith =
    (fn: (ws: string) => Promise<{ id: string } | null>) => async () => {
      if (!activeWorkspaceId) return
      close()
      focusCreated((await fn(activeWorkspaceId))?.id)
    }
  const create = {
    http: createWith((ws) => createRequest(ws)),
    graphql: createWith((ws) => createGraphqlRequest(ws)),
    connection: createWith((ws) => createConnection(ws)),
    grpc: createWith((ws) => createGrpc(ws)),
    folder: createWith((ws) => createFolder(ws)),
  }

  const selectNode = (
    kind: "request" | "websocket" | "grpc",
    id: string,
    folderId: string | null,
  ) => {
    useTreeUiStore
      .getState()
      .ensureFoldersOpen(getAncestorFolderIds(folders, folderId))
    if (kind === "request") setActiveRequest(id)
    else if (kind === "websocket") setActiveConnection(id)
    else setActiveGrpc(id)
    close()
  }

  // Resolve recent ids (any type) into renderable rows; drop ones gone from the tree.
  const recents: RecentItem[] = recentNodeIds.flatMap((id) => {
    const folderPath = (fid: string | null) => getFolderPath(folders, fid)
    const r = requests.find((x) => x.id === id)
    if (r) {
      const gql = r.body?.kind === "graphql"
      const fid = r.folderId ?? null
      return [
        {
          id,
          badge: gql ? "GQL" : abbrev(r.method),
          badgeColor: gql ? C_GQL : methodColor(r.method),
          name: r.name,
          folderPath: folderPath(fid),
          active: r.id === activeRequestId,
          onSelect: () => selectNode("request", id, fid),
        },
      ]
    }
    const c = connections.find((x) => x.id === id)
    if (c) {
      const fid = c.folderId ?? null
      return [
        {
          id,
          badge: "WS",
          badgeColor: C_WS,
          name: c.name,
          folderPath: folderPath(fid),
          active: c.id === activeConnectionId,
          onSelect: () => selectNode("websocket", id, fid),
        },
      ]
    }
    const g = grpcRequests.find((x) => x.id === id)
    if (g) {
      const fid = g.folderId ?? null
      return [
        {
          id,
          badge: "gRPC",
          badgeColor: C_GRPC,
          name: g.name,
          folderPath: folderPath(fid),
          active: g.id === activeGrpcId,
          onSelect: () => selectNode("grpc", id, fid),
        },
      ]
    }
    return []
  })

  return {
    open,
    close,
    workspaceOpen,
    activeTool,
    workspaces,
    activeWorkspaceId,
    create,
    recents,
    onSwitchWorkspace: async (w: (typeof workspaces)[number]) => {
      close()
      await switcher.handleSwitch(w)
    },
    onCreateWorkspace: () => {
      close()
      setActiveTool("welcome")
    },
    pendingWorkspace: switcher.pendingWorkspace,
    confirmCurrentWindow: switcher.confirmCurrentWindow,
    confirmNewWindow: switcher.confirmNewWindow,
    cancelPending: switcher.cancelPending,
  }
}
