import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useGrpcRequestActions, useRequestActions } from "@/plugins/hooks"
import type {
  BoundGrpcRequestAction,
  BoundRequestAction,
} from "@/plugins/types"
import { useGitStore } from "@/store/git"
import { useRequestStore } from "@/store/requests"
import { CopyAsSubmenu } from "./CopyAsSubmenu"
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
  const grpcRequests = useRequestStore((s) => s.grpcRequests)
  const requestActions = useRequestActions()
  const grpcRequestActions = useGrpcRequestActions()
  const changeByNode = useGitStore((s) => s.changeByNode)
  const ownChangeByNode = useGitStore((s) => s.ownChangeByNode)
  const descendantChangedFolders = useGitStore((s) => s.folderDescendantChanged)
  const isRepo = useGitStore((s) => s.repo?.isRepo ?? false)
  const changed = state.kind !== "workspace" && Boolean(changeByNode[state.id])

  const folderOwnChanged =
    state.kind === "folder" && Boolean(ownChangeByNode[state.id])
  const folderDescendantChanged =
    state.kind === "folder" && descendantChangedFolders.has(state.id)
  const [copyAsSubOpen, setCopyAsSubOpen] = useState(false)
  const [rollbackSubOpen, setRollbackSubOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  function handleGrpcAction(action: BoundGrpcRequestAction, id: string) {
    onClose()
    const req = useRequestStore.getState().grpcRequests.find((r) => r.id === id)
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
              <CopyAsSubmenu
                open={copyAsSubOpen}
                onOpenChange={setCopyAsSubOpen}
                actions={copyAs}
                onPick={(id) => {
                  const a = copyAs.find((x) => x.id === id)
                  if (a) handleRequestAction(a, state.id)
                }}
              />
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
      {state.kind === "grpc" &&
        (() => {
          const req = grpcRequests.find((r) => r.id === state.id)
          if (!req) return null
          const enabled = grpcRequestActions.filter(
            (a) => a.isEnabled?.(req) ?? true,
          )
          const copyAs = enabled.filter((a) => a.id.startsWith("copy-as-"))
          return (
            <CopyAsSubmenu
              open={copyAsSubOpen}
              onOpenChange={setCopyAsSubOpen}
              actions={copyAs}
              onPick={(id) => {
                const a = copyAs.find((x) => x.id === id)
                if (a) handleGrpcAction(a, state.id)
              }}
            />
          )
        })()}
      {state.kind !== "workspace" && (
        <>
          <RollbackSection
            state={state}
            isRepo={isRepo}
            changed={changed}
            folderOwnChanged={folderOwnChanged}
            folderDescendantChanged={folderDescendantChanged}
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
