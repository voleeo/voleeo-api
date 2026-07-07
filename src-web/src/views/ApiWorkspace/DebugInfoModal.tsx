import { useCallback, useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { CodeView } from "@/components/CodeView"
import { ManagementModal } from "@/components/ManagementModal"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import {
  commands,
  type EntityDebugInfo,
} from "../../../../packages/types/bindings"
import { Row, Section, StorageAndTimestampsSections } from "./DebugInfoSections"

type EntityKind = "request" | "folder" | "websocket" | "grpc"
interface Selected {
  kind: EntityKind
  id: string
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: debug view renders the raw entity as JSON
  entity: any
}

const KIND_LABEL: Record<EntityKind, string> = {
  request: "HTTP Request",
  folder: "Folder",
  websocket: "WebSocket",
  grpc: "gRPC Request",
}

/** The active request / folder / WS / gRPC entity, whichever is selected. */
function useSelectedEntity(): Selected | null {
  return useRequestStore(
    useShallow((s): Selected | null => {
      if (s.activeRequestId) {
        const e = s.requests.find((r) => r.id === s.activeRequestId)
        return e ? { kind: "request", id: e.id, name: e.name, entity: e } : null
      }
      if (s.activeFolderId) {
        const e = s.folders.find((f) => f.id === s.activeFolderId)
        return e ? { kind: "folder", id: e.id, name: e.name, entity: e } : null
      }
      if (s.activeConnectionId) {
        const e = s.connections.find((c) => c.id === s.activeConnectionId)
        return e
          ? { kind: "websocket", id: e.id, name: e.name, entity: e }
          : null
      }
      if (s.activeGrpcId) {
        const e = s.grpcRequests.find((g) => g.id === s.activeGrpcId)
        return e ? { kind: "grpc", id: e.id, name: e.name, entity: e } : null
      }
      return null
    }),
  )
}

export function DebugInfoModal() {
  const [open, setOpen] = useState(false)
  const selected = useSelectedEntity()
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const [disk, setDisk] = useState<EntityDebugInfo | null>(null)

  const toggleOpen = useCallback(() => setOpen((o) => !o), [])
  useKeydown(SHORTCUTS.DEBUG_INFO, toggleOpen)

  useEffect(() => {
    if (!open || !selected || !workspaceId) {
      setDisk(null)
      return
    }
    let alive = true
    void commands
      .debugEntityInfo(workspaceId, selected.kind, selected.id)
      .then((res) => {
        if (alive && res.status === "ok") setDisk(res.data)
      })
    return () => {
      alive = false
    }
  }, [open, selected, workspaceId])

  if (!open) return null

  return (
    <ManagementModal
      width={620}
      fitContent
      onClose={() => setOpen(false)}
      title={
        <span className="font-sans text-[1rem] font-semibold text-fg">
          Debug info
        </span>
      }
    >
      {!selected ? (
        <div className="px-5 py-8 text-center font-sans text-[0.857rem] text-muted">
          No request or folder selected.
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 w-full flex-col gap-4 px-4 py-4 overflow-y-auto">
          <Section title="Identity">
            <Row label="Kind" value={KIND_LABEL[selected.kind]} mono={false} />
            <Row label="Name" value={selected.name} mono={false} />
            <Row label="ID" value={selected.id} copyable />
            <Row label="Workspace ID" value={workspaceId ?? "—"} copyable />
            <Row
              label="Parent folder"
              value={selected.entity.folderId ?? "(root)"}
              copyable={!!selected.entity.folderId}
            />
          </Section>

          <StorageAndTimestampsSections
            disk={disk}
            createdAt={selected.entity.createdAt}
            updatedAt={selected.entity.updatedAt}
          />

          <Section title="File (raw, as stored on disk)">
            {disk?.fileContent ? (
              <div className="selectable-text rounded-[5px] border border-border overflow-hidden max-h-[340px] overflow-y-auto">
                <CodeView value={disk.fileContent} lang="yaml" />
              </div>
            ) : (
              <span className="font-sans text-[0.786rem] text-muted">
                {disk ? "Not saved to disk yet." : "Loading…"}
              </span>
            )}
          </Section>
        </div>
      )}
    </ManagementModal>
  )
}
