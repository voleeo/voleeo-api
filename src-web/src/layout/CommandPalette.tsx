import { Command } from "cmdk"
import type React from "react"
import { useCallback, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import {
  getAncestorFolderIds,
  getFolderPath,
} from "@/components/ApiRequestTree/treeUtils"
import { Glyph } from "@/components/Glyph"
import { C_GQL, C_GRPC, C_WS, methodColor } from "@/components/tokens"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher"
import { WorkspaceSwitchModal } from "@/layout/WorkspaceSwitchModal"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"

export function CommandPalette() {
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
  const {
    handleSwitch,
    pendingWorkspace,
    confirmCurrentWindow,
    confirmNewWindow,
    cancelPending,
  } = useWorkspaceSwitcher()

  const workspaceOpen = activeWorkspaceId !== null && activeTool !== "welcome"

  const openPalette = useCallback(() => {
    loadWorkspaces()
    setOpen(true)
  }, [loadWorkspaces])

  useKeydown(SHORTCUTS.COMMAND_PALETTE, openPalette, workspaceOpen)

  function close() {
    setOpen(false)
  }

  async function handleCreateHttpRequest() {
    if (!activeWorkspaceId) return
    close()
    await createRequest(activeWorkspaceId)
  }

  async function handleCreateFolder() {
    if (!activeWorkspaceId) return
    close()
    await createFolder(activeWorkspaceId)
  }

  async function handleSwitchWorkspace(w: (typeof workspaces)[number]) {
    close()
    await handleSwitch(w)
  }

  function handleSelectNode(
    kind: "request" | "websocket" | "grpc",
    id: string,
    folderId: string | null,
  ) {
    const ancestorIds = getAncestorFolderIds(folders, folderId)
    useTreeUiStore.getState().ensureFoldersOpen(ancestorIds)
    if (kind === "request") setActiveRequest(id)
    else if (kind === "websocket") setActiveConnection(id)
    else setActiveGrpc(id)
    close()
  }

  function resolveRecent(id: string) {
    const r = requests.find((x) => x.id === id)
    if (r) {
      const gql = r.body?.kind === "graphql"
      return {
        kind: "request" as const,
        name: r.name,
        badge: gql ? "GQL" : abbrev(r.method),
        color: gql ? C_GQL : methodColor(r.method),
        folderId: r.folderId ?? null,
        active: r.id === activeRequestId,
      }
    }
    const c = connections.find((x) => x.id === id)
    if (c)
      return {
        kind: "websocket" as const,
        name: c.name,
        badge: "WS",
        color: C_WS,
        folderId: c.folderId ?? null,
        active: c.id === activeConnectionId,
      }
    const g = grpcRequests.find((x) => x.id === id)
    if (g)
      return {
        kind: "grpc" as const,
        name: g.name,
        badge: "gRPC",
        color: C_GRPC,
        folderId: g.folderId ?? null,
        active: g.id === activeGrpcId,
      }
    return null
  }

  if (!workspaceOpen) return null

  return (
    <>
      {pendingWorkspace && (
        <WorkspaceSwitchModal
          workspace={pendingWorkspace}
          onCurrentWindow={confirmCurrentWindow}
          onNewWindow={confirmNewWindow}
          onCancel={cancelPending}
        />
      )}

      {open && (
        <div
          className="fixed inset-0 z-[200] bg-black/50 flex items-start justify-center"
          style={{ paddingTop: "18vh" }}
          onClick={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") close()
          }}
        >
          <div
            className="w-full mx-4"
            style={{ maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Command
              className="bg-bg border border-border rounded-[8px] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)]"
              loop
            >
              {/* Search row */}
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
                <Glyph kind="search" size={14} color="var(--base04)" />
                <Command.Input
                  autoFocus
                  placeholder="Search or type a command"
                  className="flex-1 bg-transparent border-0 outline-none font-sans text-[0.929rem] text-fg placeholder:text-muted caret-accent"
                />
              </div>

              <Command.List className="max-h-90 overflow-y-auto overflow-x-hidden py-1.5">
                <Command.Empty className="px-4 py-6 text-center font-sans text-[0.857rem] text-muted">
                  No results found.
                </Command.Empty>

                {/* Tool-specific actions */}
                {activeTool === "api" && (
                  <Group heading="Actions">
                    <PaletteItem
                      icon="send"
                      label="Create HTTP Request"
                      onSelect={handleCreateHttpRequest}
                    />
                    <PaletteItem
                      icon="folder"
                      label="Create Folder"
                      onSelect={handleCreateFolder}
                    />
                  </Group>
                )}

                {/* Recently-used items of any type (HTTP / WS / gRPC) */}
                {activeTool === "api" && recentNodeIds.length > 0 && (
                  <Group heading="Recent">
                    {recentNodeIds.map((id) => {
                      const e = resolveRecent(id)
                      if (!e) return null
                      const folderPath = getFolderPath(folders, e.folderId)
                      return (
                        <RequestPaletteItem
                          key={id}
                          badge={e.badge}
                          badgeColor={e.color}
                          name={e.name}
                          folderPath={folderPath}
                          active={e.active}
                          onSelect={() =>
                            handleSelectNode(e.kind, id, e.folderId)
                          }
                        />
                      )
                    })}
                  </Group>
                )}

                {/* Global actions — always visible when a workspace is open */}
                <Group heading="Workspace">
                  <PaletteItem
                    icon="plus"
                    label="Create Workspace"
                    onSelect={() => {
                      close()
                      setActiveTool("welcome")
                    }}
                  />
                </Group>

                {/* Switch Workspace */}
                {workspaces.length > 0 && (
                  <Group heading="Switch Workspace">
                    {workspaces.map((w) => (
                      <PaletteItem
                        key={w.id}
                        icon="api"
                        label={w.name}
                        active={w.id === activeWorkspaceId}
                        onSelect={() => handleSwitchWorkspace(w)}
                      />
                    ))}
                  </Group>
                )}
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  )
}

const GROUP_HEADING_CLS = [
  "[&_[cmdk-group-heading]]:px-3",
  "[&_[cmdk-group-heading]]:py-1.5",
  "[&_[cmdk-group-heading]]:mt-1",
  "[&_[cmdk-group-heading]]:text-[0.714rem]",
  "[&_[cmdk-group-heading]]:font-bold",
  "[&_[cmdk-group-heading]]:uppercase",
  "[&_[cmdk-group-heading]]:tracking-[0.6px]",
  "[&_[cmdk-group-heading]]:text-muted",
  "[&_[cmdk-group-heading]]:select-none",
].join(" ")

function Group({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLS}>
      {children}
    </Command.Group>
  )
}

interface PaletteItemProps {
  icon: string
  label: string
  active?: boolean
  onSelect: () => void
}

function PaletteItem({ icon, label, active, onSelect }: PaletteItemProps) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-[4px] cursor-pointer font-sans text-[0.929rem] text-fg select-none outline-none aria-selected:bg-subtle"
    >
      <Glyph kind={icon} size={13} color="var(--base04)" />
      <span className="flex-1">{label}</span>
      {active && <Glyph kind="check" size={13} color="var(--base04)" />}
    </Command.Item>
  )
}

interface RequestPaletteItemProps {
  badge: string
  badgeColor: string
  name: string
  folderPath: string
  active: boolean
  onSelect: () => void
}

function RequestPaletteItem({
  badge,
  badgeColor,
  name,
  folderPath,
  active,
  onSelect,
}: RequestPaletteItemProps) {
  // `value` is what cmdk uses for its built-in filtering
  const searchValue = [badge, folderPath, name].filter(Boolean).join(" ")

  return (
    <Command.Item
      value={searchValue}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-[4px] cursor-pointer select-none outline-none aria-selected:bg-subtle"
    >
      <span
        className="font-mono text-[0.714rem] font-semibold w-[40px] text-right shrink-0 tracking-wide"
        style={{ color: badgeColor }}
      >
        {badge}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5 font-sans text-[0.929rem] text-fg">
        {folderPath && (
          <>
            <span className="text-muted shrink-0 max-w-[45%] truncate">
              {folderPath}
            </span>
            <span className="text-muted shrink-0">›</span>
          </>
        )}
        <span className="truncate">{name}</span>
      </span>
      {active && <Glyph kind="check" size={13} color="var(--base04)" />}
    </Command.Item>
  )
}
