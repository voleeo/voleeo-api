import { useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { TabItem } from "@/components/Primitives"
import {
  HistoryTag,
  ResponseHeader,
  StatusPill,
} from "@/components/ResponseHeader"
import {
  TranscriptToolbar,
  TranscriptView,
  useTranscriptView,
} from "@/components/Transcript"
import { Spinner } from "@/components/ui/spinner"
import { SHORTCUTS } from "@/config/shortcuts"
import { cn } from "@/lib/utils"
import { selectActiveConnection, useRequestStore } from "@/store/requests"
import { useWebsocketStore } from "@/store/websocket"
import { useUiStore } from "@/store/workspace"
import type {
  TimelineEvent,
  WsMessage,
} from "../../../../../packages/types/bindings"
import { WsHistoryPicker } from "../WsHistoryPicker"
import { statusPill } from "./statusPill"
import { TimelineList } from "./TimelineList"
import { useHistoricalSession } from "./useHistoricalSession"

type Tab = "transcript" | "timeline"

const NO_MESSAGES: WsMessage[] = []
const NO_EVENTS: TimelineEvent[] = []

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

  const {
    selectedSessionId,
    setSelectedSessionId,
    historical,
    refreshKey,
    live,
    latest,
  } = useHistoricalSession(workspaceId, id, status, messages.length)

  const shown = historical ?? (messages.length === 0 ? latest : null)
  const viewMessages = shown ? (shown.messages ?? NO_MESSAGES) : messages
  const viewTimeline = shown ? (shown.events ?? NO_EVENTS) : timeline
  const transcript = useTranscriptView(viewMessages, id ?? "")
  const following =
    !historical && (status === "open" || status === "connecting")

  if (!connection || !id) return null

  const pill = statusPill(status)

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
        {tab === "transcript" && (
          <TranscriptToolbar view={transcript} count={viewMessages.length} />
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "transcript" ? (
          <TranscriptView view={transcript} live={following} />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <TimelineList events={viewTimeline} />
          </div>
        )}
      </div>
    </div>
  )
}
