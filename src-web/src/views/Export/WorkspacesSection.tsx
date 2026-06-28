import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { ExportTarget } from "../../../../packages/types/bindings"
import { SectionLabel } from "./parts"
import { WorkspaceRow } from "./WorkspaceRow"

export function WorkspacesSection({
  targets,
  selectedIds,
  activeId,
  envScope,
  privScope,
  allOn,
  headerState,
  loaded,
  onToggle,
  onToggleAll,
}: {
  targets: ExportTarget[]
  selectedIds: Set<string>
  activeId: string | null
  envScope: boolean
  privScope: boolean
  allOn: boolean
  headerState: boolean | "mixed"
  loaded: boolean
  onToggle: (id: string) => void
  onToggleAll: () => void
}) {
  return (
    <div>
      <SectionLabel
        right={
          <button
            type="button"
            onClick={onToggleAll}
            className={cn(
              "cursor-pointer text-[12.5px] font-semibold",
              allOn ? "text-muted" : "text-accent",
            )}
          >
            {allOn ? "Clear all" : "Select all"}
          </button>
        }
      >
        Workspaces{" "}
        <span className="font-semibold text-muted">
          · {selectedIds.size} of {targets.length}
        </span>
      </SectionLabel>
      <div className="rounded-xl border border-border bg-bg/40 p-1.5">
        <label className="mb-1 flex h-[38px] w-full cursor-pointer items-center gap-3 border-b border-border px-3.5">
          <Checkbox
            checked={headerState === true}
            indeterminate={headerState === "mixed"}
            onCheckedChange={onToggleAll}
          />
          <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-muted">
            All workspaces
          </span>
        </label>
        {targets.map((t) => (
          <WorkspaceRow
            key={t.id}
            target={t}
            active={t.id === activeId}
            checked={selectedIds.has(t.id)}
            includeEnvironments={envScope}
            includePrivate={privScope}
            onToggle={() => onToggle(t.id)}
          />
        ))}
        {loaded && targets.length === 0 && (
          <div className="px-3.5 py-4 text-[13px] text-muted">
            No workspaces to export.
          </div>
        )}
      </div>
    </div>
  )
}
