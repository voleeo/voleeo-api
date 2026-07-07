import { ActiveIndicator } from "@/components/ActiveIndicator"
import { C_GRPC } from "@/components/tokens"
import { cn } from "@/lib/utils"
import { useGrpcStore } from "@/store/grpc"
import type { TreeNode } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { LeafRow } from "./LeafRow"
import type { RowProps } from "./shared"

const STATUS_DOT: Record<string, string> = {
  streaming: "bg-success",
  connecting: "bg-amber-500",
  error: "bg-destructive",
}

export function GrpcRow({
  node,
  depth,
}: RowProps & { node: Extract<TreeNode, { kind: "grpc" }> }) {
  const { request } = node
  const id = request.id
  const status = useGrpcStore((s) => s.status[id])
  const activeGrpcId = useRequestStore((s) => s.activeGrpcId)
  const dotClass = status ? STATUS_DOT[status] : undefined
  const live = status === "streaming" || status === "connecting"

  return (
    <LeafRow
      id={id}
      kind="grpc"
      name={request.name}
      depth={depth}
      active={id === activeGrpcId}
      onActivate={() => useRequestStore.getState().setActiveGrpc(id)}
      badge={
        <span
          title="gRPC"
          className="font-mono text-[0.857rem] font-semibold w-9 text-right shrink-0 tracking-wide overflow-hidden"
          style={{ color: C_GRPC }}
        >
          gRPC
        </span>
      }
      statusDot={
        live ? (
          <ActiveIndicator className="ml-auto" />
        ) : (
          dotClass && (
            <span
              className={cn("ml-auto w-2 h-2 rounded-full shrink-0", dotClass)}
            />
          )
        )
      }
    />
  )
}
