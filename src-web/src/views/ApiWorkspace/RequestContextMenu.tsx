import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useRequestActions } from "@/plugins/hooks"
import type { BoundRequestAction } from "@/plugins/types"
import { useGitStore } from "@/store/git"
import { useRequestStore } from "@/store/requests"

export type CtxMenuState =
  | { kind: "workspace"; x: number; y: number }
  | { kind: "request"; id: string; x: number; y: number }
  | { kind: "folder"; id: string; x: number; y: number }
  | { kind: "websocket"; id: string; x: number; y: number }
  | { kind: "grpc"; id: string; x: number; y: number }

type ItemKindUi = "request" | "folder" | "websocket" | "grpc"

interface Props {
  state: CtxMenuState
  onClose: () => void
  onCreateRequest: (folderId?: string) => void
  onCreateFolder: (folderId?: string) => void
  onCreateConnection: (folderId?: string) => void
  onCreateGrpc: (folderId?: string) => void
  onRename: (id: string) => void
  onDuplicate: (kind: ItemKindUi, id: string) => void
  onDelete: (kind: ItemKindUi, id: string) => void
  onRollback: (kind: "request" | "folder", id: string) => void
  onShowHistory: (kind: "request" | "folder", id: string) => void
}

const ITEM_CLASSES =
  "w-full flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer font-sans text-[0.857rem] text-fg hover:bg-subtle focus:bg-subtle outline-none"
const SEP = "-mx-1 my-1 h-px bg-border"

export function RequestContextMenu({
  state,
  onClose,
  onCreateRequest,
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
  const isRepo = useGitStore((s) => s.repo?.isRepo ?? false)
  const changed = state.kind !== "workspace" && Boolean(changeByNode[state.id])
  const [copyAsSubOpen, setCopyAsSubOpen] = useState(false)
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

  const collapseSub = () => setCopyAsSubOpen(false)

  return (
    <div
      ref={menuRef}
      className="fixed z-[300] min-w-[180px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ top: state.y, left: state.x }}
    >
      {state.kind === "workspace" && (
        <>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateRequest()}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>Request</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateConnection()}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>WebSocket</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateGrpc()}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>gRPC</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateFolder()}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>Folder</span>
          </button>
        </>
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
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateRequest(state.id)}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>Request</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateConnection(state.id)}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>WebSocket</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateGrpc(state.id)}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>gRPC</span>
          </button>
          <button
            type="button"
            className={ITEM_CLASSES}
            onClick={() => onCreateFolder(state.id)}
          >
            <Glyph kind="plus" size={13} color="var(--base04)" />
            <span>Folder</span>
          </button>
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
          {isRepo && (state.kind === "request" || state.kind === "folder") && (
            <>
              <div className={SEP} />
              {changed && (
                <button
                  type="button"
                  className={ITEM_CLASSES}
                  onMouseEnter={collapseSub}
                  onClick={() => onRollback(state.kind, state.id)}
                >
                  <Glyph
                    kind="arrow-counter-clockwise"
                    size={13}
                    color="var(--base04)"
                  />
                  <span>Rollback changes</span>
                </button>
              )}
              <button
                type="button"
                className={ITEM_CLASSES}
                onMouseEnter={collapseSub}
                onClick={() => onShowHistory(state.kind, state.id)}
              >
                <Glyph kind="history" size={13} color="var(--base04)" />
                <span>Show History</span>
              </button>
            </>
          )}
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
