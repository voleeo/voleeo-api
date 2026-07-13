import type React from "react"
import { createContext } from "react"
import type { WsConnStatus } from "@/store/websocket"
import type { GitChange } from "../../../../packages/types/bindings"

export type DropZone =
  | { type: "before"; id: string }
  | { type: "after"; id: string }
  | { type: "into"; id: string }

export interface TreeCtx {
  draggingId: string | null
  draggingIds: string[]
  dropZone: DropZone | null
  startDrag: (e: React.PointerEvent, id: string) => void
  didDrag: React.RefObject<boolean>
  isFolderOpen: (id: string) => boolean
  toggleFolder: (id: string) => void
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  selectedIds: string[]
  selectRow: (id: string, modifiers: { meta: boolean; shift: boolean }) => void
  onEnterAction: (
    id: string,
    kind: "folder" | "request" | "websocket" | "grpc" | "snapshot",
  ) => void
  renamingId: string | null
  commitRename: (
    id: string,
    kind: "folder" | "request" | "websocket" | "grpc" | "snapshot",
    name: string,
  ) => void
  cancelRename: () => void
  refocusTree: () => void
  lastStatuses: Record<string, number>
  gitChangeByNode: Record<string, GitChange>
  wsStatuses: Record<string, WsConnStatus>
}

export const Ctx = createContext<TreeCtx>({} as TreeCtx)

export function DropLine({ paddingLeft }: { paddingLeft: number }) {
  return (
    <div
      className="h-[2px] bg-dnd-drop-line rounded-full my-px pointer-events-none"
      style={{ marginLeft: paddingLeft, marginRight: 12 }}
    />
  )
}
