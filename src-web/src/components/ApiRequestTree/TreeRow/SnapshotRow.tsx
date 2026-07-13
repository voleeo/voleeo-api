import type React from "react"
import { useContext, useState } from "react"
import { Ctx } from "@/components/ApiRequestTree/types"
import { Glyph } from "@/components/Glyph"
import { gitChangeColor } from "@/components/tokens"
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { cn } from "@/lib/utils"
import { useRequestStore } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"
import type { SnapshotSummary } from "../../../../../packages/types/bindings"
import { SnapshotContextMenu } from "./SnapshotContextMenu"
import { RenameInput } from "./shared"

export function SnapshotRow({
  snapshot,
  depth,
}: {
  snapshot: SnapshotSummary
  depth: number
}) {
  const active = useRequestStore((s) => s.activeSnapshotId === snapshot.id)
  const {
    gitChangeByNode,
    selectRow,
    selectedIds,
    focusedId,
    didDrag,
    renamingId,
    onEnterAction,
  } = useContext(Ctx)
  const gitChange = gitChangeByNode[snapshot.id]
  const selected = selectedIds.includes(snapshot.id)
  const focused = focusedId === snapshot.id
  const renaming = renamingId === snapshot.id
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const indent = depth * 12 + 22
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)

  const open = () => {
    if (!workspaceId) return
    useRequestStore.getState().setActiveSnapshot(snapshot.id)
    useSnapshotsStore.getState().openSnapshot(workspaceId, snapshot.id)
  }

  const onClick = (e: React.MouseEvent) => {
    if (didDrag.current) return
    const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }
    selectRow(snapshot.id, mods)
    if (!mods.meta && !mods.shift) open()
  }

  const onDoubleClick = () => {
    if (didDrag.current) return
    onEnterAction(snapshot.id, "snapshot")
  }

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!selected) selectRow(snapshot.id, { meta: false, shift: false })
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  const deleteSnapshot = async () => {
    if (!workspaceId) return
    await useSnapshotsStore.getState().deleteSnapshot(workspaceId, snapshot.id)
  }

  return (
    <>
      <div
        data-node-id={snapshot.id}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={openMenu}
        className={cn(
          "flex items-center gap-2 py-1 pr-3.5 hover:bg-subtle cursor-default",
          active
            ? "bg-surface border-l-2 border-l-fg"
            : focused || selected
              ? "bg-subtle border-l-2 border-l-transparent"
              : "border-l-2 border-l-transparent",
        )}
        style={{ paddingLeft: indent + 4 }}
      >
        <span className="inline-flex shrink-0">
          <Glyph
            kind={snapshot.pinned ? "pin" : "copy-simple"}
            size={12}
            color="var(--base04)"
          />
        </span>
        {renaming ? (
          <RenameInput
            id={snapshot.id}
            kind="snapshot"
            defaultValue={snapshot.name}
          />
        ) : (
          <span
            className={cn(
              "font-sans text-[0.857rem] text-muted truncate",
              active && "text-fg font-medium",
            )}
            style={gitChange ? { color: gitChangeColor(gitChange) } : undefined}
          >
            {snapshot.name}
          </span>
        )}
      </div>

      {menuPos && workspaceId && (
        <SnapshotContextMenu
          workspaceId={workspaceId}
          snapshotId={snapshot.id}
          pinned={snapshot.pinned}
          pos={menuPos}
          onRename={() => {
            setMenuPos(null)
            useTreeUiStore.getState().requestRename(snapshot.id)
          }}
          onDelete={() => {
            setMenuPos(null)
            setConfirmingDelete(true)
          }}
          onClose={() => setMenuPos(null)}
        />
      )}

      {confirmingDelete && (
        <ConfirmationDialog
          title="Delete saved snapshot?"
          icon="warning"
          description={
            <>
              Delete <code>{snapshot.name}</code>. The snapshot stays
              recoverable from git history if this workspace is synced.
            </>
          }
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={deleteSnapshot}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}
