import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { ActiveIndicator } from "@/components/ActiveIndicator"
import { abbrev } from "@/components/ApiRequestTree/TreeRow/shared"
import { IconToggle } from "@/components/IconToggle"
import { C_GQL, C_GRPC, C_WS, methodColor } from "@/components/tokens"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { cn } from "@/lib/utils"
import { useGrpcStore } from "@/store/grpc"
import { useHttpStore } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useWebsocketStore } from "@/store/websocket"
import { revealInTree } from "./revealInTree"

type Running = {
  id: string
  name: string
  kind: "request" | "websocket" | "grpc"
  folderId: string | null
  label: string
  color: string
}

function navigate(item: Running) {
  const s = useRequestStore.getState()
  if (item.kind === "request") s.setActiveRequest(item.id)
  else if (item.kind === "websocket") s.setActiveConnection(item.id)
  else s.setActiveGrpc(item.id)
  revealInTree(item.id, item.folderId, s.folders)
}

export function focusActive() {
  const s = useRequestStore.getState()
  const id =
    s.activeRequestId ??
    s.activeConnectionId ??
    s.activeGrpcId ??
    s.activeFolderId
  if (!id) return
  const folderId =
    s.requests.find((r) => r.id === id)?.folderId ??
    s.connections.find((c) => c.id === id)?.folderId ??
    s.grpcRequests.find((g) => g.id === id)?.folderId ??
    s.folders.find((f) => f.id === id)?.folderId ??
    null
  revealInTree(id, folderId, s.folders)
}

export function collapseAll() {
  const folderIds = useRequestStore.getState().folders.map((f) => f.id)
  useTreeUiStore.getState().collapseAll(folderIds)
}

export function expandAll() {
  useTreeUiStore.getState().expandAll()
}

export function RunningFooter() {
  const loading = useHttpStore((s) => s.loading)
  const wsStatus = useWebsocketStore((s) => s.status)
  const grpcStatus = useGrpcStore((s) => s.status)
  const { requests, connections, grpcRequests } = useRequestStore(
    useShallow((s) => ({
      requests: s.requests,
      connections: s.connections,
      grpcRequests: s.grpcRequests,
    })),
  )
  const hasActive = useRequestStore(
    (s) =>
      !!(
        s.activeRequestId ||
        s.activeConnectionId ||
        s.activeGrpcId ||
        s.activeFolderId
      ),
  )
  const hasFolders = useRequestStore((s) => s.folders.length > 0)

  const running = useMemo<Running[]>(() => {
    const out: Running[] = []
    for (const r of requests) {
      if (!loading[r.id]) continue
      const gql = r.body?.kind === "graphql"
      out.push({
        id: r.id,
        name: r.name,
        kind: "request",
        folderId: r.folderId,
        label: gql ? "GQL" : abbrev(r.method),
        color: gql ? C_GQL : methodColor(r.method),
      })
    }
    for (const c of connections) {
      const st = wsStatus[c.id]
      if (st === "open" || st === "connecting")
        out.push({
          id: c.id,
          name: c.name,
          kind: "websocket",
          folderId: c.folderId,
          label: "WS",
          color: C_WS,
        })
    }
    for (const g of grpcRequests) {
      const st = grpcStatus[g.id]
      if (st === "streaming" || st === "connecting")
        out.push({
          id: g.id,
          name: g.name,
          kind: "grpc",
          folderId: g.folderId,
          label: "gRPC",
          color: C_GRPC,
        })
    }
    return out
  }, [requests, connections, grpcRequests, loading, wsStatus, grpcStatus])

  if (running.length === 0 && !hasActive && !hasFolders) return null

  return (
    <div className="flex items-center px-3.5 py-2 border-t border-border shrink-0 font-mono text-[0.7rem]">
      {running.length > 0 && <RunningPill running={running} />}
      <div className="ml-auto flex items-center gap-0.5">
        {hasFolders && (
          <>
            <IconToggle
              icon={<ChevronsDownUpIcon size={14} />}
              title={`Collapse All (${formatKeyCombo(SHORTCUTS.COLLAPSE_ALL)})`}
              onClick={collapseAll}
            />
            <IconToggle
              icon={<ChevronsUpDownIcon size={14} />}
              title={`Expand All (${formatKeyCombo(SHORTCUTS.EXPAND_ALL)})`}
              onClick={expandAll}
            />
          </>
        )}
        {hasActive && (
          <IconToggle
            glyph="crosshair-simple"
            title={`Focus Active (${formatKeyCombo(SHORTCUTS.FOCUS_ACTIVE)})`}
            onClick={focusActive}
          />
        )}
      </div>
    </div>
  )
}

const PILL =
  "-my-0.5 flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2 py-1 text-success outline-none hover:bg-subtle"

function RunningPill({ running }: { running: Running[] }) {
  const label = (
    <>
      <ActiveIndicator />
      {running.length} running
    </>
  )

  if (running.length === 1) {
    const only = running[0]
    return (
      <button type="button" className={PILL} onClick={() => navigate(only)}>
        {label}
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(PILL, "data-[state=open]:bg-subtle")}>
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-[200px]">
        {running.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => navigate(item)}
            className="gap-2.5 font-mono text-[0.75rem] cursor-pointer focus:bg-subtle"
          >
            <span
              className="w-9 shrink-0 text-right font-semibold tracking-wide"
              style={{ color: item.color }}
            >
              {item.label}
            </span>
            <span className="truncate">{item.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
