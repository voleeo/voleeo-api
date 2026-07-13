import { useContext } from "react"
import { ActiveIndicator } from "@/components/ActiveIndicator"
import { Ctx } from "@/components/ApiRequestTree/types"
import { C_GQL, methodColor, statusDotClass } from "@/components/tokens"
import { cn } from "@/lib/utils"
import { useHttpStore } from "@/store/http"
import type { TreeNode } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { LeafRow } from "./LeafRow"
import { SnapshotRow } from "./SnapshotRow"
import { abbrev, type RowProps } from "./shared"

export function RequestRow({
  node,
  depth,
  activeRequestId,
  onSelectRequest,
}: RowProps & { node: Extract<TreeNode, { kind: "request" }> }) {
  const { lastStatuses, isFolderOpen, toggleFolder } = useContext(Ctx)
  const { request } = node
  const lastStatus = lastStatuses[request.id] ?? null
  const loading = useHttpStore((s) => Boolean(s.loading[request.id]))
  const snapshots = useSnapshotsStore((s) => s.byRequest[request.id])
  const isGraphql = request.body?.kind === "graphql"
  const hasSnapshots = Boolean(snapshots?.length)
  const open = isFolderOpen(request.id)

  return (
    <div>
      <LeafRow
        id={request.id}
        kind="request"
        name={request.name}
        depth={depth}
        active={request.id === activeRequestId}
        onActivate={() => onSelectRequest(request.id)}
        expand={
          hasSnapshots
            ? { open, onToggle: () => toggleFolder(request.id) }
            : undefined
        }
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
          loading ? (
            <ActiveIndicator className="ml-auto" />
          ) : (
            lastStatus !== null && (
              <span
                className={cn(
                  "ml-auto w-2 h-2 rounded-full shrink-0",
                  statusDotClass(lastStatus),
                )}
              />
            )
          )
        }
      />
      {hasSnapshots && open && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
            style={{ left: depth * 12 + 14 + 6 }}
          />
          {snapshots?.map((p) => (
            <SnapshotRow key={p.id} snapshot={p} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
