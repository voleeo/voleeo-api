import { useState } from "react"
import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import { Glyph } from "@/components/Glyph"
import { methodColor } from "@/components/tokens"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type {
  ImportNode_Serialize as ImportNode,
  VoleeoBundlePreview_Serialize as VoleeoBundlePreview,
} from "../../../../../packages/types/bindings"

export function VoleeoBundlePreviewStep({
  preview,
  selected,
  onToggle,
}: {
  preview: VoleeoBundlePreview
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const selectable = preview.workspaces.length > 1
  const Header = selectable ? "label" : "div"

  return (
    <div className="flex flex-col gap-3">
      {preview.workspaces.map((ws) => {
        const on = !selectable || selected.has(ws.id)
        return (
          <div
            key={ws.id}
            className="overflow-hidden rounded-[10px] border border-border bg-subtle/20"
          >
            <Header
              className={cn(
                "flex items-center gap-2.5 px-3.5 py-2.5",
                selectable && "cursor-pointer",
                on && "border-b border-border",
              )}
            >
              {selectable && (
                <Checkbox
                  checked={selected.has(ws.id)}
                  onCheckedChange={() => onToggle(ws.id)}
                />
              )}
              <Glyph kind="folder" size={15} color="var(--base0D)" />
              <span className="text-sm font-semibold text-fg">{ws.name}</span>
              {ws.encrypted && (
                <Glyph kind="key" size={12} color="var(--base0A)" />
              )}
              <span className="ml-auto text-[0.714rem] text-muted">
                {ws.requestCount} request{ws.requestCount === 1 ? "" : "s"} ·{" "}
                {ws.environmentCount} env{ws.environmentCount === 1 ? "" : "s"}
              </span>
            </Header>
            {on && (
              <div className="px-2 py-1.5">
                <Nodes
                  nodes={ws.tree}
                  collapsed={collapsed}
                  onToggleCollapse={toggle}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Nodes({
  nodes,
  collapsed,
  onToggleCollapse,
  depth = 0,
}: {
  nodes: ImportNode[]
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  depth?: number
}) {
  return (
    <div className="flex flex-col">
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <FolderRow
            key={node.id}
            node={node}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            depth={depth}
          />
        ) : (
          <RequestRow key={node.id} node={node} depth={depth} />
        ),
      )}
    </div>
  )
}

function FolderRow({
  node,
  collapsed,
  onToggleCollapse,
  depth,
}: {
  node: ImportNode
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  depth: number
}) {
  const open = !collapsed.has(node.id)
  return (
    <>
      <button
        type="button"
        onClick={() => onToggleCollapse(node.id)}
        className="flex w-full items-center gap-2 rounded-[5px] py-1.5 text-left select-none hover:bg-subtle/60"
        style={{ paddingLeft: 6 + depth * 18 }}
      >
        <Glyph kind={open ? "chevron-down" : "chevron"} size={12} />
        <Glyph kind="folder" size={14} color="var(--base04)" />
        <span className="text-[0.857rem] font-semibold text-fg">
          {node.name || "(untagged)"}
        </span>
      </button>
      {open && node.children.length > 0 && (
        <Nodes
          nodes={node.children}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          depth={depth + 1}
        />
      )}
    </>
  )
}

function RequestRow({ node, depth }: { node: ImportNode; depth: number }) {
  const method = node.method ?? "GET"
  return (
    <div
      className="flex items-center gap-2.5 py-1.5"
      style={{ paddingLeft: 28 + depth * 18 }}
    >
      <span
        title={method}
        className="w-9 shrink-0 overflow-hidden text-right font-mono text-[0.857rem] font-semibold tracking-wide"
        style={{ color: methodColor(method) }}
      >
        {abbrev(method)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[0.821rem] leading-tight text-fg">
          {node.name}
        </span>
        {node.path && (
          <span className="truncate font-mono text-[0.679rem] leading-tight text-muted">
            {node.path}
          </span>
        )}
      </span>
    </div>
  )
}
