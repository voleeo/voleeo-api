import { Command } from "cmdk"
import { Glyph } from "@/components/Glyph"
import { WorkspaceSwitchModal } from "@/layout/WorkspaceSwitchModal"
import { Group, PaletteItem, RequestPaletteItem } from "./items"
import { usePalette } from "./usePalette"

export function CommandPalette() {
  const p = usePalette()

  if (!p.workspaceOpen) return null

  return (
    <>
      {p.pendingWorkspace && (
        <WorkspaceSwitchModal
          workspace={p.pendingWorkspace}
          onCurrentWindow={p.confirmCurrentWindow}
          onNewWindow={p.confirmNewWindow}
          onCancel={p.cancelPending}
        />
      )}

      {p.open && (
        <div
          className="fixed inset-0 z-[200] bg-black/50 flex items-start justify-center"
          style={{ paddingTop: "18vh" }}
          onClick={p.close}
          onKeyDown={(e) => {
            if (e.key === "Escape") p.close()
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

                {p.activeTool === "api" && (
                  <Group heading="Actions">
                    <PaletteItem
                      icon="send"
                      label="Create HTTP Request"
                      onSelect={p.create.http}
                    />
                    <PaletteItem
                      icon="schema"
                      label="Create GraphQL Request"
                      onSelect={p.create.graphql}
                    />
                    <PaletteItem
                      icon="plug-charging"
                      label="Create WebSocket Connection"
                      onSelect={p.create.connection}
                    />
                    <PaletteItem
                      icon="arrows-left-right"
                      label="Create gRPC Request"
                      onSelect={p.create.grpc}
                    />
                    <PaletteItem
                      icon="folder"
                      label="Create Folder"
                      onSelect={p.create.folder}
                    />
                  </Group>
                )}

                {p.activeTool === "api" && p.recents.length > 0 && (
                  <Group heading="Recent">
                    {p.recents.map((r) => (
                      <RequestPaletteItem
                        key={r.id}
                        badge={r.badge}
                        badgeColor={r.badgeColor}
                        name={r.name}
                        folderPath={r.folderPath}
                        active={r.active}
                        onSelect={r.onSelect}
                      />
                    ))}
                  </Group>
                )}

                <Group heading="Workspace">
                  <PaletteItem
                    icon="plus"
                    label="Create Workspace"
                    onSelect={p.onCreateWorkspace}
                  />
                </Group>

                {p.workspaces.length > 0 && (
                  <Group heading="Switch Workspace">
                    {p.workspaces.map((w) => (
                      <PaletteItem
                        key={w.id}
                        icon="api"
                        label={w.name}
                        active={w.id === p.activeWorkspaceId}
                        onSelect={() => p.onSwitchWorkspace(w)}
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
