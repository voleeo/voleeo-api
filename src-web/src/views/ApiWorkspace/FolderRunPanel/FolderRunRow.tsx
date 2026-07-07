import { Fragment, memo } from "react"
import { ActiveIndicator } from "@/components/ActiveIndicator"
import { abbrev } from "@/components/ApiRequestTree/TreeRow"
import { Glyph } from "@/components/Glyph"
import { C_GQL, methodColor } from "@/components/tokens"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { ReqRunStatus } from "@/store/folderRun"
import { useHttpStore } from "@/store/http"
import type { HttpRequest } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useSseStore } from "@/store/sse"
import { formatDuration } from "../ResponsePane/format"
import { revealInTree } from "../revealInTree"
import type { FolderPathSegment } from "./useStoredSend"

function statusColor(status: number): string {
  if (status === 0) return "var(--base04)"
  if (status >= 200 && status < 300) return "var(--base0B)"
  if (status >= 400) return "var(--base08)"
  return "var(--base0A)"
}

function RunStateDot({ state }: { state: ReqRunStatus | undefined }) {
  if (state === "running") return <ActiveIndicator />
  if (state === "skipped")
    return <span className="w-1.5 h-1.5 rounded-full bg-muted/40 shrink-0" />
  return null
}

interface Props {
  request: HttpRequest
  included: boolean
  runState: ReqRunStatus | undefined
  maxTotalMs: number
  lastSummary: { status: number; totalMs: number } | null
  folderPath: FolderPathSegment[] | undefined
  onToggle: (id: string) => void
}

function FolderRunRowImpl({
  request,
  included,
  runState,
  maxTotalMs,
  lastSummary,
  folderPath,
  onToggle,
}: Props) {
  const response = useHttpStore((s) => s.responses[request.id])
  const error = useHttpStore((s) => s.errors[request.id])
  const loading = useHttpStore((s) => Boolean(s.loading[request.id]))
  const sseStatus = useSseStore((s) => s.open[request.id]?.status)
  const sseLastMs = useSseStore((s) => {
    const f = s.frames[request.id]
    return f?.length ? f[f.length - 1].atMs : undefined
  })
  const setActiveFolder = useRequestStore((s) => s.setActiveFolder)
  const setActiveRequest = useRequestStore((s) => s.setActiveRequest)

  const openFolder = (folderId: string) => {
    revealInTree(folderId, folderId, useRequestStore.getState().folders)
    setActiveFolder(folderId)
  }

  const openRequest = () => {
    revealInTree(
      request.id,
      request.folderId ?? null,
      useRequestStore.getState().folders,
    )
    setActiveRequest(request.id)
  }

  const isGraphql = request.body?.kind === "graphql"
  const liveSse = loading && sseStatus != null
  const status = liveSse
    ? sseStatus
    : (response?.status ?? lastSummary?.status ?? null)
  const totalMs = liveSse
    ? (sseLastMs ?? 0)
    : (response?.timing.totalMs ?? lastSummary?.totalMs ?? null)
  const barPct =
    totalMs != null && maxTotalMs > 0
      ? Math.max(2, (totalMs / maxTotalMs) * 100)
      : 0
  const barColor =
    status != null
      ? statusColor(status)
      : runState === "running"
        ? "var(--base0D)"
        : "var(--base04)"

  return (
    <div
      className={cn(
        "grid grid-cols-[18px_36px_1fr_auto] items-center gap-2.5 px-3.5 py-2 border-b border-border/60",
        !included && "opacity-45",
      )}
    >
      <Checkbox
        checked={included}
        onCheckedChange={() => onToggle(request.id)}
      />
      <span
        className="font-mono text-[0.857rem] font-semibold tracking-wide text-right shrink-0"
        title={isGraphql ? "GraphQL" : request.method}
        style={{ color: isGraphql ? C_GQL : methodColor(request.method) }}
      >
        {isGraphql ? "GQL" : abbrev(request.method)}
      </span>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <RunStateDot state={runState} />
          <button
            type="button"
            onClick={openRequest}
            title={`Open ${request.name}`}
            className="font-sans text-[0.857rem] text-fg truncate text-left cursor-pointer bg-transparent border-0 p-0 outline-none hover:text-accent transition-colors"
          >
            {request.name}
          </button>
        </div>
        {folderPath && folderPath.length > 0 && (
          <span className="flex items-center gap-1 min-w-0 text-[0.714rem] text-muted/60">
            <Glyph kind="folder" size={10} color="currentColor" />
            <span className="truncate">
              {folderPath.map((seg, i) => (
                <Fragment key={seg.id}>
                  {i > 0 && <span className="px-[3px]">/</span>}
                  <button
                    type="button"
                    onClick={() => openFolder(seg.id)}
                    title={`Open ${seg.name}`}
                    className="cursor-pointer bg-transparent border-0 p-0 outline-none hover:text-accent transition-colors"
                  >
                    {seg.name}
                  </button>
                </Fragment>
              ))}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5 justify-end min-w-[180px]">
        <div className="flex-1 h-1 rounded-full bg-subtle overflow-hidden min-w-[60px]">
          {barPct > 0 && (
            <div
              className="h-full rounded-full"
              style={{ width: `${barPct}%`, background: barColor }}
            />
          )}
        </div>
        {status != null && status !== 0 ? (
          <span
            className="editor-font text-[0.786rem] font-semibold tabular-nums shrink-0 w-8 text-right"
            style={{ color: statusColor(status) }}
          >
            {status}
          </span>
        ) : (
          <span className="editor-font text-[0.786rem] text-muted/60 shrink-0 w-8 text-right">
            {error ? "err" : runState === "skipped" ? "—" : ""}
          </span>
        )}
        <span className="editor-font text-[0.786rem] text-muted tabular-nums shrink-0 w-[68px] text-right">
          {totalMs != null && status !== 0 ? formatDuration(totalMs) : "—"}
        </span>
      </div>
    </div>
  )
}

export const FolderRunRow = memo(FolderRunRowImpl)
