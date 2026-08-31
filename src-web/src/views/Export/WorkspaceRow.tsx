import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { ExportTarget } from "../../../../packages/types/bindings"
import { Meta, Pill } from "./parts"

export function WorkspaceRow({
  target,
  active,
  checked,
  selectedFolderIds,
  showFolderSelect,
  includeEnvironments,
  includePrivate,
  onToggle,
  onToggleFolder,
}: {
  target: ExportTarget
  active: boolean
  checked: boolean
  selectedFolderIds: string[]
  showFolderSelect: boolean
  includeEnvironments: boolean
  includePrivate: boolean
  onToggle: () => void
  onToggleFolder: (folderId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const envs = includeEnvironments
    ? target.sharedEnvs + (includePrivate ? target.privateEnvs : 0)
    : 0
  const secrets =
    target.inlineSecrets +
    (includeEnvironments
      ? target.sharedSecrets + (includePrivate ? target.privateSecrets : 0)
      : 0)
  const selectedFolders = new Set(selectedFolderIds)

  return (
    <div>
      <div className="flex h-[52px] w-full items-center gap-3 rounded-lg px-3.5 text-left transition-colors hover:bg-subtle">
        {showFolderSelect &&
          (target.folders.length > 0 ? (
            <button
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} folders in ${target.name}`}
              aria-expanded={expanded}
              aria-controls={`export-folders-${target.id}`}
              className="flex size-11 -mx-2.5 cursor-pointer items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded((open) => !open)}
            >
              <span
                className={cn(
                  "inline-flex transition-transform duration-100",
                  expanded && "rotate-90",
                )}
              >
                <Glyph kind="chevron" size={12} color="var(--base04)" />
              </span>
            </button>
          ) : (
            <span className="size-6" />
          ))}
        <Checkbox
          aria-label={`Export workspace ${target.name}`}
          checked={checked}
          onCheckedChange={onToggle}
        />
        <Glyph
          kind="folder"
          size={16}
          color={checked ? "var(--base0D)" : "var(--base04)"}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">
            {target.name}
          </span>
          {active && <Pill>Active</Pill>}
        </div>
        {showFolderSelect && target.folders.length > 0 && (
          <span className="shrink-0 text-xs text-muted">
            {selectedFolderIds.length === target.folders.length
              ? "All folders"
              : `${selectedFolderIds.length} of ${target.folders.length}`}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-4">
          <Meta
            icon={
              <Glyph kind="arrows-left-right" size={13} color="currentColor" />
            }
          >
            {target.requests}
          </Meta>
          <Meta icon={<Glyph kind="stack" size={13} color="currentColor" />}>
            {envs} env{envs === 1 ? "" : "s"}
          </Meta>
          {secrets > 0 && (
            <Meta
              icon={<Glyph kind="key" size={13} color="currentColor" />}
              tone="text-warn"
            >
              {secrets}
            </Meta>
          )}
        </div>
      </div>
      {showFolderSelect && expanded && target.folders.length > 0 && (
        <div
          id={`export-folders-${target.id}`}
          role="group"
          aria-label={`Root folders in ${target.name}`}
          className="mb-1 rounded-lg bg-surface/40 py-1"
        >
          <div className="px-12 py-1 text-[11px] text-muted">
            {checked
              ? "Choose the root folders to include."
              : "Select the workspace to change its folders."}
          </div>
          {target.folders.map((folder) => (
            <label
              key={folder.id}
              className={cn(
                "flex h-11 items-center gap-3 rounded-md px-12 text-sm text-fg transition-colors",
                checked
                  ? "cursor-pointer hover:bg-subtle"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <Checkbox
                aria-label={`Export folder ${folder.name} from ${target.name}`}
                checked={selectedFolders.has(folder.id)}
                disabled={!checked}
                onCheckedChange={() => onToggleFolder(folder.id)}
              />
              <Glyph
                kind="folder"
                size={14}
                color={
                  selectedFolders.has(folder.id)
                    ? "var(--base0D)"
                    : "var(--base04)"
                }
              />
              <span className="truncate">{folder.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
