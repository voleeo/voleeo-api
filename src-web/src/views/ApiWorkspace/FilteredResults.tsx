import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import { getFolderPath } from "@/components/ApiRequestTree/treeUtils"
import { Glyph } from "@/components/Glyph"
import { methodColor } from "@/components/tokens"
import { cn } from "@/lib/utils"
import type { ApiFolder, HttpRequest } from "@/store/requests"
import type { SnapshotSummary } from "../../../../packages/types/bindings"

interface Props {
  requests: HttpRequest[]
  snapshots: SnapshotSummary[]
  folders: ApiFolder[]
  activeRequestId: string | null
  activeSnapshotId: string | null
  onSelect: (requestId: string, folderId: string | null) => void
  onSelectSnapshot: (snapshotId: string) => void
}

export function FilteredResults({
  requests,
  snapshots,
  folders,
  activeRequestId,
  activeSnapshotId,
  onSelect,
  onSelectSnapshot,
}: Props) {
  if (requests.length === 0 && snapshots.length === 0) {
    return (
      <div className="px-3.5 py-4 font-mono text-[0.714rem] text-muted text-center">
        No matches
      </div>
    )
  }

  const requestRows = requests.map((r) => {
    const folderPath = getFolderPath(folders, r.folderId ?? null)
    const isActive = r.id === activeRequestId
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => onSelect(r.id, r.folderId ?? null)}
        className={cn(
          "w-full flex items-center gap-2 py-[3px] pr-3.5 border-l-2 cursor-pointer outline-none hover:bg-subtle text-left",
          isActive ? "bg-surface border-l-fg" : "border-l-transparent",
        )}
        style={{ paddingLeft: 18 }}
      >
        <span
          className="font-mono text-[0.714rem] font-semibold w-[34px] text-right shrink-0 tracking-wide"
          style={{ color: methodColor(r.method) }}
        >
          {abbrev(r.method)}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "font-sans text-[0.857rem] text-fg truncate",
              isActive && "font-medium",
            )}
          >
            {r.name}
          </div>
          {folderPath && (
            <div className="font-mono text-[0.714rem] text-muted truncate">
              {folderPath}
            </div>
          )}
        </div>
      </button>
    )
  })

  const snapshotRows = snapshots.map((p) => {
    const isActive = p.id === activeSnapshotId
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onSelectSnapshot(p.id)}
        className={cn(
          "w-full flex items-center gap-2 py-[3px] pr-3.5 border-l-2 cursor-pointer outline-none hover:bg-subtle text-left",
          isActive ? "bg-surface border-l-fg" : "border-l-transparent",
        )}
        style={{ paddingLeft: 18 }}
      >
        <Glyph
          kind={p.pinned ? "pin" : "copy-simple"}
          size={12}
          color={p.pinned ? "var(--base0D)" : "var(--base04)"}
        />
        <span
          className={cn(
            "font-sans text-[0.857rem] text-muted truncate flex-1 min-w-0",
            isActive && "text-fg font-medium",
          )}
        >
          {p.name}
        </span>
      </button>
    )
  })

  return (
    <>
      {requestRows}
      {snapshotRows}
    </>
  )
}
