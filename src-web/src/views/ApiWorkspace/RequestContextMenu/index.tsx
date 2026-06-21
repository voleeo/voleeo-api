import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useRequestActions } from "@/plugins/hooks"
import type { BoundRequestAction } from "@/plugins/types"
import { useGitStore } from "@/store/git"
import { useRequestStore } from "@/store/requests"
import { CreateItems } from "./CreateItems"
import { ITEM_CLASSES, SEP } from "./contextMenuStyles"
import { RollbackSection } from "./RollbackSection"
import type { CtxMenuState, ItemKindUi, RollbackTarget } from "./types"

export type { CtxMenuState, RollbackTarget } from "./types"

interface Props {
  state: CtxMenuState
  onClose: () => void
  onCreateRequest: (folderId?: string) => void
  onCreateGraphql: (folderId?: string) => void
  onCreateFolder: (folderId?: string) => void
  onCreateConnection: (folderId?: string) => void
  onCreateGrpc: (folderId?: string) => void
  onRename: (id: string) => void
  onDuplicate: (kind: ItemKindUi, id: string) => void
  onDelete: (kind: ItemKindUi, id: string) => void
  onRollback: (target: RollbackTarget, id: string) => void
  onShowHistory: (kind: "request" | "folder", id: string) => void
}

export function RequestContextMenu({
  state,
  onClose,
  onCreateRequest,
  onCreateGraphql,
  onCreateFolder,
  onCreateConnection,
  onCreateGrpc,
  onRename,
  onDuplicate,
  onDelete,
  onRollback,
  onShowHistory,
}: Props) {
  const requests = useRequestStore((s) => s.requests)
  const requestActions = useRequestActions()
  const changeByNode = useGitStore((s) => s.changeByNode)
  const ownChangeByNode = useGitStore((s) => s.ownChangeByNode)
  const folderDescendantChanged = useGitStore((s) => s.folderDescendantChanged)
  const isRepo = useGitStore((s) => s.repo?.isRepo ?? false)
  const changed = state.kind !== "workspace" && Boolean(changeByNode[state.id])

  const folderOwnChanged =
    state.kind === "folder" && Boolean(ownChangeByNode[state.id])
  const folderReqChanged =
    state.kind === "folder" && folderDescendantChanged.has(state.id)
  const [copyAsSubOpen, setCopyAsSubOpen] = useState(false)
  const [rollbackSubOpen, setRollbackSubOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside pointerdown or Escape.
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

  function handleRequestAction(action: BoundRequestAction, id: string) {
    onClose()
    const req = useRequestStore.getState().requests.find((r) => r.id === id)
    if (!req) return
    void action.onInvoke(req)
  }

  const collapseSub = () => {
    setCopyAsSubOpen(false)
    setRollbackSubOpen(false)
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[300] min-w-[180px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ top: state.y, left: state.x }}
    >
      {state.kind === "workspace" && (
        <CreateItems
          onCreateRequest={onCreateRequest}
          onCreateGraphql={onCreateGraphql}
          onCreateConnection={onCreateConnection}
          onCreateGrpc={onCreateGrpc}
          onCreateFolder={onCreateFolder}
        />
      )}
      {state.kind !== "workspace" && (
        <>
          <button
            type="button"
            className={ITEM_CLASSES}
            onMouseEnter={collapseSub}
            onClick={() => onRename(state.id)}
          >
            <Glyph kind="edit" size={13} color="var(--base04)" />
            <span>Rename</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onMouseEnter={collapseSub}
            onClick={() => onDuplicate(state.kind, state.id)}
          >
            <Glyph kind="copy" size={13} color="var(--base04)" />
            <span>Duplicate</span>
          </button>
        </>
      )}
      {state.kind === "folder" && (
        <>
          <div className={SEP} />
          <CreateItems
            folderId={state.id}
            onCreateRequest={onCreateRequest}
            onCreateGraphql={onCreateGraphql}
            onCreateConnection={onCreateConnection}
            onCreateGrpc={onCreateGrpc}
            onCreateFolder={onCreateFolder}
          />
        </>
      )}
      {state.kind === "request" &&
        (() => {
          const req = requests.find((r) => r.id === state.id)
          if (!req) return null
          const enabled = requestActions.filter(
            (a) => a.isEnabled?.(req) ?? true,
          )
          const copyAs = enabled.filter((a) => a.id.startsWith("copy-as-"))
          const other = enabled.filter((a) => !a.id.startsWith("copy-as-"))
          return (
            <>
              {copyAs.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    className={ITEM_CLASSES}
                    onMouseEnter={() => setCopyAsSubOpen(true)}
                    onFocus={() => setCopyAsSubOpen(true)}
                    onClick={() => setCopyAsSubOpen((v) => !v)}
                  >
                    <Glyph kind="copy" size={13} color="var(--base04)" />
                    <span className="flex-1 text-left">Copy as ...</span>
                    <Glyph kind="chevron" size={11} color="var(--base04)" />
                  </button>
                  {copyAsSubOpen && (
                    <div
                      className="absolute left-full top-0 -ml-px z-[301] min-w-[150px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
                      onMouseEnter={() => setCopyAsSubOpen(true)}
                    >
                      {copyAs.map((a) => {
                        const short = a.label.replace(/^Copy as\s+/i, "")
                        return (
                          <button
                            key={a.id}
                            type="button"
                            className={ITEM_CLASSES}
                            onClick={() => handleRequestAction(a, state.id)}
                          >
                            <Glyph
                              kind={a.glyph ?? "copy"}
                              size={13}
                              color="var(--base04)"
                            />
                            <span>{short}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              {other.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={ITEM_CLASSES}
                  onMouseEnter={collapseSub}
                  onClick={() => handleRequestAction(a, state.id)}
                >
                  <Glyph
                    kind={a.glyph ?? "copy"}
                    size={13}
                    color="var(--base04)"
                  />
                  <span>{a.label}</span>
                </button>
              ))}
            </>
          )
        })()}
      {state.kind !== "workspace" && (
        <>
          <RollbackSection
            state={state}
            isRepo={isRepo}
            changed={changed}
            folderOwnChanged={folderOwnChanged}
            folderReqChanged={folderReqChanged}
            rollbackSubOpen={rollbackSubOpen}
            setRollbackSubOpen={setRollbackSubOpen}
            collapseSub={collapseSub}
            onRollback={onRollback}
            onShowHistory={onShowHistory}
          />
          <div className={SEP} />
          <button
            type="button"
            className={cn(
              ITEM_CLASSES,
              "text-error hover:bg-error/10 focus:bg-error/10",
            )}
            onMouseEnter={collapseSub}
            onClick={() => onDelete(state.kind, state.id)}
          >
            <Glyph kind="trash" size={13} color="var(--base08)" />
            <span>Delete</span>
          </button>
        </>
      )}
    </div>
  )
}
