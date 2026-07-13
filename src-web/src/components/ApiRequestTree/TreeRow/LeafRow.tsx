import type React from "react"
import { useContext } from "react"
import { Ctx, DropLine } from "@/components/ApiRequestTree/types"
import { Glyph } from "@/components/Glyph"
import { gitChangeColor } from "@/components/tokens"
import { cn } from "@/lib/utils"
import { dragAttrs, RenameInput, type RowKind } from "./shared"

interface Props {
  id: string
  kind: Extract<RowKind, "request" | "websocket" | "grpc">
  name: string
  depth: number
  active: boolean
  badge: React.ReactNode
  statusDot?: React.ReactNode
  onActivate: () => void
  expand?: { open: boolean; onToggle: () => void }
}

export function LeafRow({
  id,
  kind,
  name,
  depth,
  active,
  badge,
  statusDot,
  onActivate,
  expand,
}: Props) {
  const {
    draggingIds,
    dropZone,
    startDrag,
    didDrag,
    focusedId,
    selectedIds,
    selectRow,
    onEnterAction,
    renamingId,
    gitChangeByNode,
  } = useContext(Ctx)

  const gitChange = gitChangeByNode[id]
  const indent = depth * 12 + 14
  const focused = focusedId === id
  const selected = selectedIds.includes(id)
  const renaming = renamingId === id
  const dim = draggingIds.includes(id)

  const dropBefore = dropZone?.type === "before" && dropZone.id === id
  const dropAfter = dropZone?.type === "after" && dropZone.id === id

  return (
    <div>
      {dropBefore && <DropLine paddingLeft={indent + 4} />}
      <div
        {...dragAttrs(id, kind, depth, startDrag)}
        onClick={(e) => {
          if (didDrag.current) return
          const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }
          selectRow(id, mods)
          if (!mods.meta && !mods.shift) onActivate()
        }}
        onDoubleClick={() => {
          if (didDrag.current) return

          if (expand) expand.onToggle()
          else onEnterAction(id, kind)
        }}
        className={[
          "flex items-center gap-2 py-1.5 pr-3.5 hover:bg-subtle",
          active
            ? "bg-surface border-l-2 border-l-fg"
            : focused || selected
              ? "bg-subtle border-l-2 border-l-transparent"
              : "border-l-2 border-l-transparent",
          dim ? "opacity-40" : "",
        ].join(" ")}
        style={{ touchAction: "none", paddingLeft: indent + 4 }}
      >
        {expand && (
          <span
            className="-ml-1.5 inline-flex w-[12px] shrink-0 transition-transform duration-100"
            style={{ transform: expand.open ? "rotate(90deg)" : "none" }}
            onClick={(e) => {
              e.stopPropagation()
              expand.onToggle()
            }}
          >
            <Glyph kind="chevron" size={13} color="var(--base04)" />
          </span>
        )}
        {badge}
        {renaming ? (
          <RenameInput id={id} kind={kind} defaultValue={name} />
        ) : (
          <span
            className={cn(
              "font-sans text-[0.857rem] text-fg truncate",
              active && "font-medium",
            )}
            style={gitChange ? { color: gitChangeColor(gitChange) } : undefined}
          >
            {name}
          </span>
        )}
        {statusDot}
      </div>
      {dropAfter && <DropLine paddingLeft={indent + 4} />}
    </div>
  )
}
