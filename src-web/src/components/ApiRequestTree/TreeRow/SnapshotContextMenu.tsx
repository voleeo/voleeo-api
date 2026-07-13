import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import { useRequestActions } from "@/plugins/hooks"
import { useSnapshotsStore } from "@/store/snapshots"
import { useToastStore } from "@/store/toast"
import {
  ITEM_CLASSES,
  SEP,
} from "@/views/ApiWorkspace/RequestContextMenu/contextMenuStyles"
import { commands } from "../../../../../packages/types/bindings"

export function SnapshotContextMenu({
  workspaceId,
  snapshotId,
  pinned,
  pos,
  onRename,
  onDelete,
  onClose,
}: {
  workspaceId: string
  snapshotId: string
  pinned: boolean
  pos: { x: number; y: number }
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [copyAsOpen, setCopyAsOpen] = useState(false)
  const copyAs = useRequestActions().filter((a) => a.id.startsWith("copy-as-"))

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        onClose()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  async function runCopyAs(actionId: string) {
    onClose()
    const action = copyAs.find((a) => a.id === actionId)
    if (!action) return
    const res = await commands.snapshotGet(workspaceId, snapshotId)
    if (res.status === "error") {
      useToastStore.getState().show(errorMessage(res.error), 3500, "error")
      return
    }
    await action.onInvoke(res.data.request)
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[300] min-w-[180px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ top: pos.y, left: pos.x }}
    >
      <button
        type="button"
        className={ITEM_CLASSES}
        onMouseEnter={() => setCopyAsOpen(false)}
        onClick={() => {
          onClose()
          useSnapshotsStore
            .getState()
            .setPinned(workspaceId, snapshotId, !pinned)
        }}
      >
        <Glyph kind="pin" size={13} color="var(--base04)" />
        <span>{pinned ? "Unpin" : "Pin"}</span>
      </button>
      <button
        type="button"
        className={ITEM_CLASSES}
        onMouseEnter={() => setCopyAsOpen(false)}
        onClick={onRename}
      >
        <Glyph kind="edit" size={13} color="var(--base04)" />
        <span>Rename</span>
      </button>

      {copyAs.length > 0 && (
        <div className="relative">
          <button
            type="button"
            className={ITEM_CLASSES}
            onMouseEnter={() => setCopyAsOpen(true)}
            onFocus={() => setCopyAsOpen(true)}
            onClick={() => setCopyAsOpen((v) => !v)}
          >
            <Glyph kind="copy" size={13} color="var(--base04)" />
            <span className="flex-1 text-left">Copy as ...</span>
            <Glyph kind="chevron" size={11} color="var(--base04)" />
          </button>
          {copyAsOpen && (
            <div
              className="absolute left-full top-0 -ml-px z-[301] min-w-[150px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
              onMouseEnter={() => setCopyAsOpen(true)}
            >
              {copyAs.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={ITEM_CLASSES}
                  onClick={() => runCopyAs(a.id)}
                >
                  <Glyph
                    kind={a.glyph ?? "copy"}
                    size={13}
                    color="var(--base04)"
                  />
                  <span>{a.label.replace(/^Copy as\s+/i, "")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={SEP} />
      <button
        type="button"
        className={cn(
          ITEM_CLASSES,
          "text-error hover:bg-error/10 focus:bg-error/10",
        )}
        onMouseEnter={() => setCopyAsOpen(false)}
        onClick={onDelete}
      >
        <Glyph kind="trash" size={13} color="var(--base08)" />
        <span>Delete</span>
      </button>
    </div>
  )
}
