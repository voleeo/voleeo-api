import { useContext } from "react"
import { Ctx } from "@/components/ApiRequestTree/types"
import { C_WS } from "@/components/tokens"
import { cn } from "@/lib/utils"
import type { TreeNode } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { LeafRow } from "./LeafRow"
import type { RowProps } from "./shared"

const STATUS_DOT: Record<string, string> = {
  open: "bg-success",
  connecting: "bg-amber-500",
  closing: "bg-amber-500",
  error: "bg-destructive",
}

export function ConnectionRow({
  node,
  depth,
}: RowProps & { node: Extract<TreeNode, { kind: "websocket" }> }) {
  const { wsStatuses } = useContext(Ctx)
  const { connection } = node
  const id = connection.id
  const status = wsStatuses[id] ?? "closed"
  const activeConnectionId = useRequestStore((s) => s.activeConnectionId)
  const dotClass = STATUS_DOT[status]

  return (
    <LeafRow
      id={id}
      kind="websocket"
      name={connection.name}
      depth={depth}
      active={id === activeConnectionId}
      onActivate={() => useRequestStore.getState().setActiveConnection(id)}
      badge={
        <span
          title="WebSocket"
          className="font-mono text-[0.857rem] font-semibold w-9 text-right shrink-0 tracking-wide overflow-hidden"
          style={{ color: C_WS }}
        >
          WS
        </span>
      }
      statusDot={
        dotClass && (
          <span
            className={cn("ml-auto w-2 h-2 rounded-full shrink-0", dotClass)}
          />
        )
      }
    />
  )
}
