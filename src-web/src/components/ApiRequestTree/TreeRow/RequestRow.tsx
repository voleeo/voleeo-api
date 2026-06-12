import { useContext } from "react"
import { Ctx } from "@/components/ApiRequestTree/types"
import { C_GQL, methodColor, statusDotClass } from "@/components/tokens"
import { cn } from "@/lib/utils"
import type { TreeNode } from "@/store/requests"
import { LeafRow } from "./LeafRow"
import { abbrev, type RowProps } from "./shared"

export function RequestRow({
  node,
  depth,
  activeRequestId,
  onSelectRequest,
}: RowProps & { node: Extract<TreeNode, { kind: "request" }> }) {
  const { lastStatuses } = useContext(Ctx)
  const { request } = node
  const lastStatus = lastStatuses[request.id] ?? null
  const isGraphql = request.body?.kind === "graphql"

  return (
    <LeafRow
      id={request.id}
      kind="request"
      name={request.name}
      depth={depth}
      active={request.id === activeRequestId}
      onActivate={() => onSelectRequest(request.id)}
      badge={
        <span
          title={isGraphql ? "GraphQL" : request.method}
          className="font-mono text-[0.857rem] font-semibold w-9 text-right shrink-0 tracking-wide overflow-hidden"
          style={{ color: isGraphql ? C_GQL : methodColor(request.method) }}
        >
          {isGraphql ? "GQL" : abbrev(request.method)}
        </span>
      }
      statusDot={
        lastStatus !== null && (
          <span
            className={cn(
              "ml-auto w-2 h-2 rounded-full shrink-0",
              statusDotClass(lastStatus),
            )}
          />
        )
      }
    />
  )
}
