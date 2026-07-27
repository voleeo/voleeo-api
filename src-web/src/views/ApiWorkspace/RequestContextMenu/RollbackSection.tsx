import type { Dispatch, ReactNode, SetStateAction } from "react"
import { Glyph } from "@/components/Glyph"
import { ITEM_CLASSES, SEP, subMenuClasses } from "./contextMenuStyles"
import type { CtxMenuState, RollbackTarget } from "./types"

interface Props {
  state: CtxMenuState
  isRepo: boolean
  changed: boolean
  folderOwnChanged: boolean
  folderDescendantChanged: boolean
  rollbackSubOpen: boolean
  setRollbackSubOpen: Dispatch<SetStateAction<boolean>>
  subFlipLeft: boolean
  collapseSub: () => void
  onRollback: (target: RollbackTarget, id: string) => void
  onShowHistory: (kind: "request" | "folder", id: string) => void
}

export function RollbackSection({
  state,
  isRepo,
  changed,
  folderOwnChanged,
  folderDescendantChanged,
  rollbackSubOpen,
  setRollbackSubOpen,
  subFlipLeft,
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
        rollbackItem("Rollback Changes", "request")}

      {state.kind === "folder" &&
        folderOwnChanged &&
        folderDescendantChanged && (
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
                className={subMenuClasses(subFlipLeft)}
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
                  onClick={() => onRollback("folder-children", id)}
                >
                  <span>Contents</span>
                </button>
              </div>
            )}
          </div>
        )}
      {state.kind === "folder" &&
        folderOwnChanged &&
        !folderDescendantChanged &&
        rollbackItem("Rollback Folder", "folder")}
      {state.kind === "folder" &&
        !folderOwnChanged &&
        folderDescendantChanged &&
        rollbackItem("Rollback Contents", "folder-children")}

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
