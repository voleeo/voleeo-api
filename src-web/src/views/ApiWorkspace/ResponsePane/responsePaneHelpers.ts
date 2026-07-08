import { useMemo } from "react"
import type {
  HttpResponse,
  TimelineEvent,
} from "../../../../../packages/types/bindings"
import type { BodyInfo } from "./BodyTab"

type SseOpen = Pick<HttpResponse, "status" | "statusText" | "headers">

function buildLiveSseResponse(
  requestId: string,
  open: SseOpen,
  bytes: number,
  totalMs: number,
  events: TimelineEvent[],
): HttpResponse {
  return {
    requestId,
    status: open.status,
    statusText: open.statusText,
    headers: open.headers,
    body: "",
    bodySize: bytes,
    bodyIsText: true,
    timing: {
      dnsMs: 0,
      connectMs: 0,
      tlsMs: 0,
      firstByteMs: 0,
      downloadMs: 0,
      totalMs,
    },
    events,
  }
}

export function useLiveSseResponse(
  active: boolean,
  requestId: string | null,
  open: SseOpen | undefined,
  bytes: number,
  totalMs: number,
  events: TimelineEvent[],
): HttpResponse | undefined {
  return useMemo(
    () =>
      active && open && requestId
        ? buildLiveSseResponse(requestId, open, bytes, totalMs, events)
        : undefined,
    [active, open, requestId, bytes, totalMs, events],
  )
}

export function codeBodyFlags(
  response: HttpResponse | null,
  isSse: boolean,
  isHtml: boolean,
  body: BodyInfo,
): { isCodeBody: boolean; canFilter: boolean } {
  const isCodeBody =
    !!response &&
    !isSse &&
    response.bodyIsText &&
    !response.bodyWindowed &&
    !isHtml &&
    !body.isBinary
  return {
    isCodeBody,
    canFilter: body.lang === "json" || body.lang === "xml",
  }
}
