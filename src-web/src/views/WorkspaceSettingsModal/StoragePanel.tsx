import type { Workspace } from "@/store/workspace"
import { EncryptionSection } from "./EncryptionSection"
import { LocationSection } from "./LocationSection"
import { PanelHeading } from "./PanelHeading"

interface StoragePanelProps {
  workspace: Workspace
  onWorkspaceChanged: (ws: Workspace) => void
  onEncryptionChanged: () => void
}

export function StoragePanel({
  workspace,
  onWorkspaceChanged,
  onEncryptionChanged,
}: StoragePanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <PanelHeading
        title="Storage"
        description="Where workspace data lives on this machine and how it's secured."
      />

      <LocationSection
        workspaceId={workspace.id}
        syncDir={workspace.syncDir ?? null}
        onChanged={onWorkspaceChanged}
      />

      <div className="border-t border-border" />

      <EncryptionSection
        workspaceId={workspace.id}
        encrypted={workspace.encrypted ?? false}
        onEncryptionChanged={onEncryptionChanged}
      />
    </div>
  )
}
