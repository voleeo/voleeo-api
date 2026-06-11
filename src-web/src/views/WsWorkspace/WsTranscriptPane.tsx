import { useEffect, useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { TabItem } from "@/components/Primitives"
import {
  HistoryTag,
  ResponseHeader,
  StatusPill,
} from "@/components/ResponseHeader"
import { Spinner } from "@/components/ui/spinner"
import { SHORTCUTS } from "@/config/shortcuts"
import { cn } from "@/lib/utils"
import { selectActiveConnection, useRequestStore } from "@/store/requests"
import { useWebsocketStore } from "@/store/websocket"
import { useUiStore } from "@/store/workspace"
import type {
  StoredWsSession,
  TimelineEvent,
  WsMessage,
} from "../../../../packages/types/bindings"
import { WsHistoryPicker } from "./WsHistoryPicker"

type Tab = "transcript" | "timeline"

const NO_MESSAGES: WsMessage[] = []
const NO_EVENTS: TimelineEvent[] = []

function formatTime(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString()
}

function MessageRow({ m }: { m: WsMessage }) {
  const out = m.direction === "outgoing"
  return (
    <div className="flex gap-2 px-3 py-1.5 border-b border-border/50 hover:bg-subtle">
      <span
        title={out ? "Sent" : "Received"}
        className={cn(
          "font-mono text-[0.857rem] shrink-0",
          out ? "text-accent" : "text-success",
        )}
      >
        {out ? "↑" : "↓"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[0.643rem] font-mono text-muted">
          <span>{formatTime(m.at)}</span>
          <span className="uppercase">{m.kind}</span>
          <span>{m.size} B</span>
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono text-[0.786rem] text-fg mt-0.5">
          {m.data}
        </pre>
      </div>
    </div>
  )
}

/** Connection-status pill, styled like the HTTP response status badge. */
function statusPill(status: string): {
  label: string
  className: string
  textClass: string
} {
  switch (status) {
    case "open":
      return {
        label: "CONNECTED",
        className: "border-success bg-surface",
        textClass: "text-success",
      }
    case "connecting":
      return {
        label: "CONNECTING",
        className: "border-amber-500/80 bg-surface",
        textClass: "text-amber-500",
      }
    case "closing":
      return {
        label: "CLOSING",
        className: "border-amber-500/80 bg-surface",
        textClass: "text-amber-500",
      }
    case "error":
      return {
        label: "ERROR",
        className: "border-destructive bg-surface",
        textClass: "text-destructive",
      }
    default:
      return {
        label: "DISCONNECTED",
        className: "border-border bg-surface",
        textClass: "text-muted",
      }
  }
}

export function WsTranscriptPane() {
  const connection = useRequestStore(selectActiveConnection)
  const workspaceId = useUiStore((s) => s.activeWorkspaceId) ?? ""
  const id = connection?.id
  const messages =
    useWebsocketStore((s) => (id ? s.transcripts[id] : undefined)) ??
    NO_MESSAGES
  const timeline =
    useWebsocketStore((s) => (id ? s.timelines[id] : undefined)) ?? NO_EVENTS
  const status =
    useWebsocketStore((s) => (id ? s.status[id] : undefined)) ?? "closed"
  const [tab, setTab] = useState<Tab>("transcript")

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [historical, setHistorical] = useState<StoredWsSession | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (status === "connecting" || status === "open") {
      setSelectedSessionId(null)
      setHistorical(null)
    }
    setRefreshKey((k) => k + 1)
  }, [status])

  const getSession = useWebsocketStore((s) => s.getSession)
  const listSessions = useWebsocketStore((s) => s.listSessions)
  useEffect(() => {
    if (!id || !selectedSessionId) {
      setHistorical(null)
      return
    }
    let cancelled = false
    getSession(workspaceId, id, selectedSessionId).then((data) => {
      if (!cancelled) setHistorical(data)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId, id, selectedSessionId, getSession])

  const live =
    status === "open" || status === "connecting" || status === "closing"

  // With no live transcript and nothing explicitly selected, preload the most
  // recent session so an idle connection still shows its last result.
  const [latest, setLatest] = useState<StoredWsSession | null>(null)
  useEffect(() => {
    if (!id || live || messages.length > 0 || selectedSessionId) {
      setLatest(null)
      return
    }
    let cancelled = false
    void listSessions(workspaceId, id).then((items) => {
      if (cancelled) return
      const first = items[0]
      if (!first) return setLatest(null)
      void getSession(workspaceId, id, first.id).then((data) => {
        if (!cancelled) setLatest(data)
      })
    })
    return () => {
      cancelled = true
    }
  }, [
    workspaceId,
    id,
    live,
    messages.length,
    selectedSessionId,
    listSessions,
    getSession,
  ])

  if (!connection || !id) return null

  const pill = statusPill(status)
  const shown = historical ?? (messages.length === 0 ? latest : null)
  const viewMessages = shown ? (shown.messages ?? NO_MESSAGES) : messages
  const viewTimeline = shown ? (shown.events ?? NO_EVENTS) : timeline

  if (
    !historical &&
    viewMessages.length === 0 &&
    viewTimeline.length === 0 &&
    status === "closed"
  ) {
    return (
      <EmptyPaneShortcuts
        rows={[
          { label: "Send Message", combo: SHORTCUTS.SEND_REQUEST },
          { label: "New Item", combo: SHORTCUTS.NEW_ITEM },
        ]}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ResponseHeader
        trailing={
          <WsHistoryPicker
            workspaceId={workspaceId}
            connectionId={id}
            selectedId={selectedSessionId}
            refreshKey={refreshKey}
            live={live}
            onSelect={(sessionId, isLatest) =>
              setSelectedSessionId(isLatest ? null : sessionId)
            }
            onClear={() => setSelectedSessionId(null)}
          />
        }
      >
        <StatusPill className={cn(pill.className, pill.textClass)}>
          {(status === "connecting" || status === "closing") && (
            <Spinner className="size-3 shrink-0" aria-label="Connecting" />
          )}
          {pill.label}
        </StatusPill>
        <div className="font-mono text-[0.75rem] text-muted">
          {viewMessages.length}{" "}
          {viewMessages.length === 1 ? "message" : "messages"}
        </div>
        {historical && <HistoryTag />}
      </ResponseHeader>

      <div className="pt-1.5 px-3.5 border-b border-border flex shrink-0">
        <TabItem
          label={
            viewMessages.length > 0 ? (
              <>
                TRANSCRIPT{" "}
                <span className="font-normal opacity-40 tracking-normal">
                  {viewMessages.length}
                </span>
              </>
            ) : (
              "TRANSCRIPT"
            )
          }
          active={tab === "transcript"}
          onClick={() => setTab("transcript")}
        />
        <TabItem
          label={
            viewTimeline.length > 0 ? (
              <>
                TIMELINE{" "}
                <span className="font-normal opacity-40 tracking-normal">
                  {viewTimeline.length}
                </span>
              </>
            ) : (
              "TIMELINE"
            )
          }
          active={tab === "timeline"}
          onClick={() => setTab("timeline")}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "transcript" ? (
          viewMessages.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-[0.714rem] text-muted">
              No messages yet
            </div>
          ) : (
            viewMessages.map((m) => <MessageRow key={m.id} m={m} />)
          )
        ) : viewTimeline.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[0.714rem] text-muted">
            No events yet
          </div>
        ) : (
          viewTimeline.map((e, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, never reordered
              key={`${e.atMs}-${e.kind}-${i}`}
              className="flex gap-2 px-3 py-1 border-b border-border/50 font-mono text-[0.714rem]"
            >
              <span className="text-muted w-14 shrink-0">
                {(e.atMs ?? 0).toFixed(0)}ms
              </span>
              <span className="uppercase text-accent w-16 shrink-0">
                {e.kind}
              </span>
              <span className="text-fg break-all">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
