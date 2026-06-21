import { useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import type {
  ImportNode_Serialize as ImportNode,
  ImportPreview_Serialize as ImportPreview,
} from "../../../../../packages/types/bindings"
import { ImportTree } from "./ImportTree"
import {
  collectIds,
  filterTree,
  requestIds,
  totalRequests,
} from "./importFilter"

interface WorkspaceOption {
  id: string
  name: string
}

interface ImportPreviewStepProps {
  preview: ImportPreview
  selected: Set<string>
  onChange: (next: Set<string>) => void
  workspaces: WorkspaceOption[]
  destId: string
  onDestChange: (id: string) => void
}

const EMPTY = new Set<string>()

export function ImportPreviewStep({
  preview,
  selected,
  onChange,
  workspaces,
  destId,
  onDestChange,
}: ImportPreviewStepProps) {
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const filtering = query.trim() !== ""
  const visible = useMemo(
    () => filterTree(preview.tree, query),
    [preview.tree, query],
  )

  const total = totalRequests(preview.tree)
  const selectedCount = useMemo(
    () => requestIds(preview.tree).filter((id) => selected.has(id)).length,
    [preview.tree, selected],
  )

  function toggle(node: ImportNode, checked: boolean) {
    const next = new Set(selected)
    for (const id of collectIds(node)) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  function setVisibleSelected(on: boolean) {
    const next = new Set(selected)
    for (const id of requestIds(visible)) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <Glyph kind="search" size={13} color="var(--base04)" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or path…"
            className="w-full bg-bg border border-border rounded-[6px] pl-8 pr-2.5 py-1.5 text-[0.821rem] text-fg outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-3 text-[0.75rem]">
          <button
            type="button"
            className="text-accent hover:underline cursor-pointer"
            onClick={() => setVisibleSelected(true)}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-muted hover:underline cursor-pointer"
            onClick={() => setVisibleSelected(false)}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[0.75rem] text-muted">
          <span className="text-fg font-semibold">{selectedCount}</span> of{" "}
          {total} request{total === 1 ? "" : "s"}
          {preview.variableCount > 0
            ? ` · ${preview.variableCount} variable${preview.variableCount === 1 ? "" : "s"}`
            : ""}
        </span>
        <div className="flex items-center gap-2 text-[0.75rem] text-muted">
          <span>Import into</span>
          <Select value={destId} onValueChange={(v) => v && onDestChange(v)}>
            <SelectTrigger size="sm">
              <span className="block max-w-[160px] truncate">
                {destId === "new"
                  ? "New workspace"
                  : (workspaces.find((w) => w.id === destId)?.name ??
                    "New workspace")}
              </span>
            </SelectTrigger>
            <SelectContent className="min-w-[200px] max-w-[260px]">
              <SelectItem value="new">New workspace</SelectItem>
              {workspaces.map((w) => (
                <SelectItem
                  key={w.id}
                  value={w.id}
                  textClassName="block truncate"
                >
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-[360px] overflow-y-auto border border-border rounded-[6px] p-1.5">
        {visible.length === 0 ? (
          <div className="py-10 text-center text-[0.786rem] text-muted">
            No requests match.
          </div>
        ) : (
          <ImportTree
            nodes={visible}
            selected={selected}
            collapsed={filtering ? EMPTY : collapsed}
            onToggle={toggle}
            onToggleCollapse={toggleCollapse}
          />
        )}
      </div>

      {preview.warnings.length > 0 && (
        <div className="flex flex-col gap-1 border border-[var(--base0A)]/40 rounded-[5px] px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[0.714rem] text-[var(--base0A)]">
            <Glyph kind="warning" size={12} color="var(--base0A)" />
            {preview.warnings.length} note
            {preview.warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="text-[0.714rem] text-muted leading-relaxed list-disc pl-4">
            {preview.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
