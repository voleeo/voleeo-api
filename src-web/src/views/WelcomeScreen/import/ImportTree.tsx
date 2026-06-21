import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import { Glyph } from "@/components/Glyph"
import { methodColor } from "@/components/tokens"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { ImportNode_Serialize as ImportNode } from "../../../../../packages/types/bindings"
import { folderCounts } from "./importFilter"

interface ImportTreeProps {
  nodes: ImportNode[]
  selected: Set<string>
  collapsed: Set<string>
  onToggle: (node: ImportNode, checked: boolean) => void
  onToggleCollapse: (id: string) => void
  depth?: number
}

export function ImportTree({
  nodes,
  selected,
  collapsed,
  onToggle,
  onToggleCollapse,
  depth = 0,
}: ImportTreeProps) {
  return (
    <div className="flex flex-col">
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <FolderRow
            key={node.id}
            node={node}
            selected={selected}
            collapsed={collapsed}
            onToggle={onToggle}
            onToggleCollapse={onToggleCollapse}
            depth={depth}
          />
        ) : (
          <RequestRow
            key={node.id}
            node={node}
            checked={selected.has(node.id)}
            onToggle={onToggle}
            depth={depth}
          />
        ),
      )}
    </div>
  )
}

function FolderRow({
  node,
  selected,
  collapsed,
  onToggle,
  onToggleCollapse,
  depth,
}: Required<Omit<ImportTreeProps, "nodes">> & { node: ImportNode }) {
  const { selected: sel, total } = folderCounts(node, selected)
  const allSelected = total > 0 && sel === total
  const isOpen = !collapsed.has(node.id)

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 rounded-[5px] hover:bg-subtle/60 cursor-pointer select-none"
        style={{ paddingLeft: 6 + depth * 18 }}
        onClick={() => onToggle(node, !allSelected)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse(node.id)
          }}
          className="grid place-items-center size-4 shrink-0 text-muted cursor-pointer outline-none"
        >
          <Glyph kind={isOpen ? "chevron-down" : "chevron"} size={12} />
        </button>
        <Checkbox
          checked={allSelected}
          indeterminate={sel > 0 && !allSelected}
          className="pointer-events-none"
        />
        <span className="text-[0.857rem] font-semibold text-fg">
          {node.name || "(untagged)"}
        </span>
        <span className="font-mono text-[0.679rem] text-muted">
          {sel}/{total}
        </span>
        {node.description && (
          <span className="text-[0.714rem] text-muted truncate">
            {node.description}
          </span>
        )}
      </div>
      {isOpen && node.children.length > 0 && (
        <ImportTree
          nodes={node.children}
          selected={selected}
          collapsed={collapsed}
          onToggle={onToggle}
          onToggleCollapse={onToggleCollapse}
          depth={depth + 1}
        />
      )}
    </>
  )
}

function RequestRow({
  node,
  checked,
  onToggle,
  depth,
}: {
  node: ImportNode
  checked: boolean
  onToggle: (node: ImportNode, checked: boolean) => void
  depth: number
}) {
  const color = methodColor(node.method ?? "GET")
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 py-1.5 rounded-[5px] cursor-pointer select-none",
        checked ? "hover:bg-subtle/60" : "opacity-80 hover:bg-subtle/40",
      )}
      style={{ paddingLeft: 28 + depth * 18 }}
      onClick={() => onToggle(node, !checked)}
    >
      <Checkbox checked={checked} className="pointer-events-none" />
      <span
        title={node.method ?? ""}
        className="font-mono text-[0.857rem] font-semibold w-9 text-right shrink-0 tracking-wide overflow-hidden"
        style={{ color }}
      >
        {abbrev(node.method ?? "GET")}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-[0.821rem] text-fg truncate leading-tight">
          {node.name}
        </span>
        {node.path && (
          <span className="font-mono text-[0.679rem] text-muted truncate leading-tight">
            {node.path}
          </span>
        )}
      </span>
    </div>
  )
}
