import { useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/store/workspace"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"
import { DnsPanel } from "./DnsPanel"
import { StoragePanel } from "./StoragePanel"
import { WorkspaceAuthPanel } from "./WorkspaceAuthPanel"
import { WorkspaceHeadersPanel } from "./WorkspaceHeadersPanel"
import { WorkspacePanel } from "./WorkspacePanel"

type Section = "workspace" | "storage" | "headers" | "auth" | "dns"

interface NavItem {
  id: Section
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: "workspace", label: "Workspace" },
  { id: "storage", label: "Storage" },
  { id: "headers", label: "Headers" },
  { id: "auth", label: "Auth" },
  { id: "dns", label: "DNS" },
]

interface WorkspaceSettingsModalProps {
  onClose: () => void
  /** Navigate to this section when the modal opens. Defaults to "workspace". */
  initialSection?: Section
  /** Focus this entry (e.g. a header name) within the opened section. */
  initialFocusKey?: string
}

export function WorkspaceSettingsModal({
  onClose,
  initialSection,
  initialFocusKey,
}: WorkspaceSettingsModalProps) {
  const { activeWorkspaceId, workspaces, loadWorkspaces } = useUiStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      workspaces: s.workspaces,
      loadWorkspaces: s.loadWorkspaces,
    })),
  )
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  if (!workspace) return null
  return (
    <WorkspaceSettingsModalInner
      workspace={workspace}
      loadWorkspaces={loadWorkspaces}
      initialSection={initialSection}
      initialFocusKey={initialFocusKey}
      onClose={onClose}
    />
  )
}

function WorkspaceSettingsModalInner({
  workspace: initialWorkspace,
  loadWorkspaces,
  initialSection,
  initialFocusKey,
  onClose,
}: {
  workspace: Workspace
  loadWorkspaces: () => Promise<void>
  initialSection?: Section
  initialFocusKey?: string
  onClose: () => void
}) {
  // Keep a local copy so Storage panel can update syncDir without a full reload
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [activeSection, setActiveSection] = useState<Section>(
    initialSection ?? "workspace",
  )
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(workspace.name)

  const dnsCommitRef = useRef<(() => Promise<void> | void) | null>(null)

  async function handleClose() {
    await dnsCommitRef.current?.()
    await loadWorkspaces()
    onClose()
  }

  function startEditing() {
    setNameValue(workspace.name)
    setEditingName(true)
  }

  async function handleRename() {
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === workspace.name) {
      setEditingName(false)
      return
    }
    const res = await commands.renameWorkspace(workspace.id, trimmed)
    if (res.status === "ok") {
      setWorkspace((w) => ({ ...w, name: trimmed }))
      await loadWorkspaces()
    }
    setEditingName(false)
  }

  function handleWorkspaceChanged(updated: Workspace) {
    setWorkspace(updated)
  }

  return (
    <ManagementModal
      onClose={handleClose}
      title={
        editingName ? (
          <input
            autoFocus
            value={nameValue}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename()
              if (e.key === "Escape") setEditingName(false)
            }}
            className="font-sans text-[1rem] font-semibold text-fg bg-transparent border-0 outline-none select-text min-w-0 max-w-[320px]"
          />
        ) : (
          <>
            <span className="font-sans text-[1rem] font-semibold text-fg">
              {workspace.name}
            </span>
            <button
              type="button"
              onClick={startEditing}
              title="Rename workspace"
              className="p-0.5 rounded-[3px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none opacity-50 hover:opacity-100 transition-opacity"
            >
              <Glyph kind="edit" size={13} color="var(--base04)" />
            </button>
          </>
        )
      }
    >
      <div className="w-50 border-r border-border flex flex-col shrink-0 py-4">
        <nav className="flex flex-col gap-y-1 px-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center px-3 py-[6px] rounded-md text-left font-sans text-[0.929rem] cursor-pointer border-0 outline-none transition-colors w-full",
                activeSection === item.id
                  ? "bg-accent/10 text-accent"
                  : "bg-transparent text-muted hover:bg-subtle hover:text-fg",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeSection === "workspace" && (
          <WorkspacePanel
            workspace={workspace}
            onNavigateToStorage={() => setActiveSection("storage")}
          />
        )}
        {activeSection === "storage" && (
          <StoragePanel
            workspace={workspace}
            onWorkspaceChanged={handleWorkspaceChanged}
            onEncryptionChanged={() => {
              setWorkspace((w) => ({ ...w, encrypted: true }))
              loadWorkspaces()
            }}
          />
        )}
        {activeSection === "headers" && (
          <WorkspaceHeadersPanel
            workspace={workspace}
            focusKey={initialFocusKey}
          />
        )}
        {activeSection === "auth" && (
          <WorkspaceAuthPanel workspace={workspace} />
        )}
        {activeSection === "dns" && (
          <DnsPanel workspace={workspace} commitRef={dnsCommitRef} />
        )}
      </div>
    </ManagementModal>
  )
}
