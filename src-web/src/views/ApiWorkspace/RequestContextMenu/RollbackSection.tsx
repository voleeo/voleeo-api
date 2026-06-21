import type { Dispatch, ReactNode, SetStateAction } from "react"
import { Glyph } from "@/components/Glyph"
import { ITEM_CLASSES, SEP } from "./contextMenuStyles"
import type { CtxMenuState, RollbackTarget } from "./types"

interface Props {
  state: CtxMenuState
  isRepo: boolean
  changed: boolean
  folderOwnChanged: boolean
  folderReqChanged: boolean
  rollbackSubOpen: boolean
  setRollbackSubOpen: Dispatch<SetStateAction<boolean>>
  collapseSub: () => void
  onRollback: (target: RollbackTarget, id: string) => void
  onShowHistory: (kind: "request" | "folder", id: string) => void
}

export function RollbackSection({
  state,
  isRepo,
  changed,
  folderOwnChanged,
  folderReqChanged,
  rollbackSubOpen,
  setRollbackSubOpen,
  collapseSub,
  onRollback,
  onShowHistory,
}: Props) {
  if (!isRepo || (state.kind !== "request" && state.kind !== "folder"))
    return null
  const id = state.id

  const rollbackItem = (label: string, target: RollbackTarget): ReactNode => (
    <button
      type="button"
      className={ITEM_CLASSES}
      onMouseEnter={collapseSub}
      onClick={() => onRollback(target, id)}
    >
      <Glyph kind="arrow-counter-clockwise" size={13} color="var(--base04)" />
      <span>{label}</span>
    </button>
  )

  return (
    <>
      <div className={SEP} />
      {state.kind === "request" &&
        changed &&
        rollbackItem("Rollback changes", "request")}
      {state.kind === "folder" && folderOwnChanged && folderReqChanged && (
        <div className="relative">
          <button
            type="button"
            className={ITEM_CLASSES}
            onMouseEnter={() => {
              collapseSub()
              setRollbackSubOpen(true)
            }}
            onFocus={() => setRollbackSubOpen(true)}
            onClick={() => setRollbackSubOpen((v) => !v)}
          >
            <Glyph
              kind="arrow-counter-clockwise"
              size={13}
              color="var(--base04)"
            />
            <span className="flex-1 text-left">Rollback</span>
            <Glyph kind="chevron" size={11} color="var(--base04)" />
          </button>
          {rollbackSubOpen && (
            <div
              className="absolute left-full top-0 -ml-px z-[301] min-w-[150px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
              onMouseEnter={() => setRollbackSubOpen(true)}
            >
              <button
                type="button"
                className={ITEM_CLASSES}
                onClick={() => onRollback("folder", id)}
              >
                <span>Folder</span>
              </button>
              <button
                type="button"
                className={ITEM_CLASSES}
                onClick={() => onRollback("folder-requests", id)}
              >
                <span>Requests</span>
              </button>
            </div>
          )}
        </div>
      )}
      {state.kind === "folder" &&
        folderOwnChanged &&
        !folderReqChanged &&
        rollbackItem("Rollback Folder", "folder")}
      {state.kind === "folder" &&
        !folderOwnChanged &&
        folderReqChanged &&
        rollbackItem("Rollback Requests", "folder-requests")}
      <button
        type="button"
        className={ITEM_CLASSES}
        onMouseEnter={collapseSub}
        onClick={() => onShowHistory(state.kind, id)}
      >
        <Glyph kind="history" size={13} color="var(--base04)" />
        <span>Show History</span>
      </button>
    </>
  )
}
