import type React from "react"
import { useContext, useRef } from "react"
import { Ctx } from "@/components/ApiRequestTree/types"
import type { TreeNode } from "@/store/requests"

export interface RowProps {
  node: TreeNode
  depth: number
  activeRequestId: string | null
  onSelectRequest: (id: string) => void
}

export type RowKind = "folder" | "request" | "websocket" | "grpc"

export function RenameInput({
  id,
  kind,
  defaultValue,
}: {
  id: string
  kind: RowKind
  defaultValue: string
}) {
  const { commitRename, cancelRename } = useContext(Ctx)
  const ref = useRef<HTMLInputElement>(null)

  function commit() {
    commitRename(id, kind, ref.current?.value ?? defaultValue)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation()
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      cancelRename()
    }
  }

  return (
    <input
      ref={ref}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      defaultValue={defaultValue}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 bg-transparent border-none outline-none font-sans text-[0.857rem] text-fg"
      style={{ caretColor: "var(--base05)" }}
    />
  )
}

export function dragAttrs(
  id: string,
  kind: string,
  depth: number,
  startDrag: (e: React.PointerEvent, id: string) => void,
) {
  return {
    "data-node-id": id,
    "data-node-kind": kind,
    "data-node-depth": String(depth),
    onPointerDown: (e: React.PointerEvent) => startDrag(e, id),
    style: { touchAction: "none" as const },
  }
}

export function abbrev(m: string) {
  const known: Record<string, string> = {
    DELETE: "DEL",
    OPTIONS: "OPT",
    CONNECT: "CON",
    PATCH: "PTCH",
    TRACE: "TRCE",
  }
  // Short methods (GET/PUT/POST/HEAD) pass through; long customs clip to the
  // fixed-width column — full value on hover.
  return known[m] ?? (m.length > 4 ? m.slice(0, 4) : m)
}
