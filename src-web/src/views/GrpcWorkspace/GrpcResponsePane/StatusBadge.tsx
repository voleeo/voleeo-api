import type { ReactNode } from "react"
import { Dot } from "@/components/Dot"
import { StatusPill } from "@/components/ResponseHeader"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { GrpcStatus } from "@/store/grpc"
import {
  formatBytes,
  formatDuration,
} from "@/views/ApiWorkspace/ResponsePane/format"
import type { GrpcResponse } from "../../../../../packages/types/bindings"
import { byteLen } from "./views"

const STATUS_PILL: Record<GrpcStatus, string> = {
  idle: "text-muted",
  connecting: "text-amber-500",
  streaming: "text-success",
  done: "text-muted",
  error: "text-destructive",
}

/** A tab label with a dimmed trailing count (hidden when zero). */
export function countLabel(label: string, n: number): ReactNode {
  if (n === 0) return label
  return (
    <>
      {label}{" "}
      <span className="font-normal opacity-40 tracking-normal">{n}</span>
    </>
  )
}

/** The status line: streaming pill + message count, or unary status code, time
 *  and size — mirroring the HTTP response header. */
export function StatusBadge({
  loading,
  streaming,
  status,
  error,
  response,
  msgCount,
}: {
  loading: boolean
  streaming: boolean
  status: GrpcStatus
  error?: string
  response?: GrpcResponse
  msgCount: number
}) {
  if (streaming)
    return (
      <>
        <span className={cn("font-mono text-[0.857rem]", STATUS_PILL[status])}>
          {status.toUpperCase()}
        </span>
        <span className="font-mono text-[0.72rem] text-muted">
          {msgCount} msg
        </span>
      </>
    )
  if (loading)
    return (
      <>
        <Spinner className="size-3.5 text-fg shrink-0" aria-label="Loading" />
        <span className="font-mono text-[0.75rem] text-muted">Sending…</span>
      </>
    )
  if (error && !response)
    return (
      <StatusPill className="border-destructive text-destructive">
        ERROR
      </StatusPill>
    )
  if (response) {
    const ok = response.statusCode === 0
    return (
      <>
        <StatusPill
          className={
            ok
              ? "border-success text-success"
              : "border-destructive text-destructive"
          }
        >
          {response.statusCode} {response.statusMessage || (ok ? "OK" : "")}
        </StatusPill>
        <span className="inline-flex items-center font-mono text-[0.75rem] text-muted">
          {formatDuration(response.totalMs ?? 0)}
          <Dot size={13} />
          {formatBytes(byteLen(response.message))}
        </span>
      </>
    )
  }
  return (
    <span className="font-mono text-[0.75rem] text-muted">
      Send a request to see the response
    </span>
  )
}
