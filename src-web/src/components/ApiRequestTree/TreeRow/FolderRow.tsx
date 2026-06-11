import { useContext } from "react"
import { getId } from "@/components/ApiRequestTree/treeUtils"
import { Ctx, DropLine } from "@/components/ApiRequestTree/types"
import { Glyph } from "@/components/Glyph"
import { gitChangeColor } from "@/components/tokens"
import type { TreeNode } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { Row } from "./Row"
import { dragAttrs, RenameInput, type RowProps } from "./shared"

export function FolderRow({
  node,
  depth,
  activeRequestId,
  onSelectRequest,
}: RowProps & { node: Extract<TreeNode, { kind: "folder" }> }) {
  const {
    draggingIds,
    dropZone,
    startDrag,
    didDrag,
    isFolderOpen,
    toggleFolder,
    focusedId,
    selectedIds,
    selectRow,
    renamingId,
    gitChangeByNode,
  } = useContext(Ctx)

  const id = node.folder.id
  const gitChange = gitChangeByNode[id]
  const indent = depth * 12 + 14
  const dim = draggingIds.includes(id)
  const open = isFolderOpen(id)
  const hasKids = node.children.length > 0
  const focused = focusedId === id
  const selected = selectedIds.includes(id)
  const renaming = renamingId === id

  const dropBefore = dropZone?.type === "before" && dropZone.id === id
  const dropAfter = dropZone?.type === "after" && dropZone.id === id
  const dropInto = dropZone?.type === "into" && dropZone.id === id

  return (
    <div>
      {dropBefore && <DropLine paddingLeft={indent} />}
      <div
        {...dragAttrs(id, "folder", depth, startDrag)}
        onClick={(e) => {
          if (didDrag.current) return
          selectRow(id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
            useRequestStore.getState().setActiveFolder(id)
          }
        }}
        onDoubleClick={() => {
          if (didDrag.current || !hasKids) return
          toggleFolder(id)
        }}
        className={[
          "flex items-center gap-1.5 py-1.5 pr-3.5 hover:bg-subtle",
          "font-sans text-[0.857rem] text-fg",
          dim ? "opacity-40" : "",
          (focused || selected) && !dropInto ? "bg-subtle" : "",
          dropInto
            ? "border-2 border-dnd-drop-line rounded-[3px] bg-subtle"
            : "",
        ].join(" ")}
        style={{ touchAction: "none", paddingLeft: indent }}
      >
        <span
          className="inline-flex w-[12px] shrink-0 transition-transform duration-100"
          style={{ transform: hasKids && open ? "rotate(90deg)" : "none" }}
          onClick={
            hasKids
              ? (e) => {
                  e.stopPropagation()
                  selectRow(id, { meta: false, shift: false })
                  toggleFolder(id)
                }
              : undefined
          }
        >
          {hasKids && <Glyph kind="chevron" size={13} color="var(--base04)" />}
        </span>
        <Glyph
          kind="folder"
          size={15}
          color={node.folder.color ?? "var(--base04)"}
        />
        {renaming ? (
          <RenameInput id={id} kind="folder" defaultValue={node.folder.name} />
        ) : (
          <span
            className="truncate"
            style={gitChange ? { color: gitChangeColor(gitChange) } : undefined}
          >
            {node.folder.name}
          </span>
        )}
      </div>

      {open && (
        <div className="relative">
          {/* Vertical guide aligned with the chevron centre. */}
          <div
            className="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
            style={{ left: indent + 5 }}
          />
          {node.children.map((child) => (
            <Row
              key={getId(child)}
              node={child}
              depth={depth + 1}
              activeRequestId={activeRequestId}
              onSelectRequest={onSelectRequest}
            />
          ))}
        </div>
      )}

      {dropAfter && <DropLine paddingLeft={indent} />}
    </div>
  )
}
