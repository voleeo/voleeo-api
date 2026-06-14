import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { CodeView } from "@/components/CodeView"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { cn } from "@/lib/utils"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import {
  commands,
  type EntityDebugInfo,
} from "../../../../packages/types/bindings"

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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Row({
  label,
  value,
  mono = true,
  copyable = false,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1100)
    } catch {
      /* no-op */
    }
  }
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-baseline py-[3px]">
      <span className="font-sans text-[0.786rem] text-muted">{label}</span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span
          className={cn(
            "flex-1 min-w-0 text-[0.786rem] text-fg break-all",
            mono ? "font-mono" : "font-sans",
          )}
        >
          {value || "—"}
        </span>
        {copyable && value && (
          <button
            type="button"
            onClick={copy}
            className="shrink-0 text-muted/70 hover:text-fg cursor-pointer border-0 bg-transparent outline-none"
            aria-label="Copy"
          >
            <Glyph
              kind={copied ? "check" : "copy"}
              size={11}
              color="currentColor"
            />
          </button>
        )}
      </span>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <span className="font-sans text-[0.714rem] uppercase tracking-[1.2px] text-muted/70 font-semibold mb-1.5">
        {title}
      </span>
      {children}
    </div>
  )
}

export function DebugInfoModal() {
  const [open, setOpen] = useState(false)
  const selected = useSelectedEntity()
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const [disk, setDisk] = useState<EntityDebugInfo | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code === "KeyI" &&
        e.shiftKey &&
        e.ctrlKey &&
        e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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

          <Section title="Storage">
            <Row label="File name" value={disk?.fileName ?? "…"} copyable />
            <Row label="Path" value={disk?.logicalPath ?? "…"} copyable />
            {disk?.resolvedPath && disk.resolvedPath !== disk.logicalPath && (
              <Row label="Resolved" value={disk.resolvedPath} copyable />
            )}
            {disk?.syncLinkTarget && (
              <Row label="Sync link →" value={disk.syncLinkTarget} copyable />
            )}
            <Row
              label="On disk"
              value={
                disk
                  ? disk.exists
                    ? `yes · ${fmtSize(disk.sizeBytes ?? 0)}`
                    : "no (unsaved)"
                  : "…"
              }
              mono={false}
            />
            {disk?.modified && (
              <Row label="Modified" value={disk.modified} mono={false} />
            )}
            {disk?.responseFile && (
              <Row label="Responses" value={disk.responseFile} copyable />
            )}
          </Section>

          {(selected.entity.createdAt || selected.entity.updatedAt) && (
            <Section title="Timestamps">
              {selected.entity.createdAt && (
                <Row
                  label="Created"
                  value={selected.entity.createdAt}
                  mono={false}
                />
              )}
              {selected.entity.updatedAt && (
                <Row
                  label="Updated"
                  value={selected.entity.updatedAt}
                  mono={false}
                />
              )}
            </Section>
          )}

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
