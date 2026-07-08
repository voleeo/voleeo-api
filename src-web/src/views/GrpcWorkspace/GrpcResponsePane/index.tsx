import { useEffect, useState } from "react"
import { EmptyPaneShortcuts } from "@/components/EmptyPaneShortcuts"
import { IconToggle } from "@/components/IconToggle"
import { TabItem } from "@/components/Primitives"
import { HistoryTag, ResponseHeader } from "@/components/ResponseHeader"
import {
  TranscriptToolbar,
  TranscriptView,
  useTranscriptView,
} from "@/components/Transcript"
import { SHORTCUTS } from "@/config/shortcuts"
import { useGrpcStore } from "@/store/grpc"
import { selectActiveGrpc, useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { formatDuration } from "@/views/ApiWorkspace/ResponsePane/format"
import { useCodeTools } from "@/views/ApiWorkspace/ResponsePane/useCodeTools"
import { GrpcHistoryPicker } from "./GrpcHistoryPicker"
import { countLabel, StatusBadge } from "./StatusBadge"
import { useGrpcHistory } from "./useGrpcHistory"
import { HeaderTable, TimelineList, UnaryBody } from "./views"

type UnaryTab = "response" | "metadata" | "trailers" | "timing"
type StreamTab = "transcript" | "timeline"

export function GrpcResponsePane() {
  const request = useRequestStore(selectActiveGrpc)
  const workspaceId = useUiStore((s) => s.activeWorkspaceId) ?? ""
  const id = request?.id ?? ""
  const status = useGrpcStore((s) => s.status[id]) ?? "idle"
  const liveResponse = useGrpcStore((s) => s.responses[id])
  const loading = useGrpcStore((s) => s.loading[id])
  const error = useGrpcStore((s) => s.errors[id])
  const liveTranscript = useGrpcStore((s) => s.transcripts[id]) ?? []
  const liveTimeline = useGrpcStore((s) => s.timelines[id]) ?? []
  const hydrate = useGrpcStore((s) => s.hydrate)
  const clearResponse = useGrpcStore((s) => s.clearResponse)

  useEffect(() => {
    if (workspaceId && id) void hydrate(workspaceId, id)
  }, [workspaceId, id, hydrate])

  const streaming = status !== "idle" || liveTranscript.length > 0

  const [unaryTab, setUnaryTab] = useState<UnaryTab>("response")
  const [streamTab, setStreamTab] = useState<StreamTab>("transcript")
  const {
    histId,
    histUnary,
    histSession,
    refreshKey,
    hasHistory,
    latestUnary,
    checking,
    onSelectHistory,
    onClearHistory,
  } = useGrpcHistory({
    workspaceId,
    id,
    streaming,
    status,
    liveTranscriptLength: liveTranscript.length,
    liveResponse,
    error,
    clearResponse,
  })

  const messages = histSession?.messages ?? liveTranscript
  const transcript = useTranscriptView(messages, id)
  const codeTools = useCodeTools()

  if (!request) return null

  const response = histUnary ?? liveResponse ?? latestUnary
  const events = streaming
    ? (histSession?.events ?? liveTimeline)
    : (histUnary?.events ?? response?.events ?? [])
  const viewing = histId !== null
  const live = !viewing && (status === "streaming" || status === "connecting")
  const showHeader =
    !!response || !!loading || streaming || !!error || hasHistory

  if (!showHeader) {
    if (checking) return <div className="h-full bg-bg" />
    return (
      <EmptyPaneShortcuts
        rows={[
          { label: "Send Request", combo: SHORTCUTS.SEND_REQUEST },
          { label: "New Request", combo: SHORTCUTS.NEW_ITEM },
        ]}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg">
      {showHeader && (
        <ResponseHeader
          trailing={
            workspaceId &&
            id && (
              <GrpcHistoryPicker
                workspaceId={workspaceId}
                requestId={id}
                mode={streaming ? "session" : "unary"}
                selectedId={histId}
                refreshKey={refreshKey}
                onSelect={onSelectHistory}
                onClear={onClearHistory}
              />
            )
          }
        >
          {viewing && <HistoryTag />}
          <StatusBadge
            loading={!!loading}
            streaming={streaming}
            status={status}
            error={error}
            response={response}
            msgCount={messages.length}
          />
        </ResponseHeader>
      )}

      <div className="pt-1.5 px-3.5 border-b border-border flex shrink-0">
        {streaming ? (
          <>
            <TabItem
              label="TRANSCRIPT"
              active={streamTab === "transcript"}
              onClick={() => setStreamTab("transcript")}
            />
            <TabItem
              label="TIMELINE"
              active={streamTab === "timeline"}
              onClick={() => setStreamTab("timeline")}
            />
            {streamTab === "transcript" && (
              <TranscriptToolbar view={transcript} count={messages.length} />
            )}
          </>
        ) : (
          <>
            <TabItem
              label="RESPONSE"
              active={unaryTab === "response"}
              onClick={() => setUnaryTab("response")}
            />
            <TabItem
              label={countLabel("METADATA", response?.metadata?.length ?? 0)}
              active={unaryTab === "metadata"}
              onClick={() => setUnaryTab("metadata")}
            />
            <TabItem
              label={countLabel("TRAILERS", response?.trailers?.length ?? 0)}
              active={unaryTab === "trailers"}
              onClick={() => setUnaryTab("trailers")}
            />
            <TabItem
              label={
                response ? (
                  <>
                    TIMING{" "}
                    <span className="font-normal opacity-40 tracking-normal">
                      {formatDuration(response.totalMs ?? 0)}
                    </span>
                  </>
                ) : (
                  "TIMING"
                )
              }
              active={unaryTab === "timing"}
              onClick={() => setUnaryTab("timing")}
            />
            {unaryTab === "response" && response?.message !== undefined && (
              <div className="ml-auto flex items-center gap-1 pr-0.5">
                <IconToggle
                  glyph="filter"
                  title="Filter (JSONPath)"
                  active={codeTools.filterOpen}
                  onClick={() =>
                    codeTools.filterOpen
                      ? codeTools.closeFilter()
                      : codeTools.openFilter()
                  }
                />
                <IconToggle
                  glyph="search"
                  title="Find in response"
                  active={codeTools.findOpen}
                  onClick={() =>
                    codeTools.findOpen
                      ? codeTools.closeFind()
                      : codeTools.openFind()
                  }
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {streaming ? (
          streamTab === "timeline" ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <TimelineList events={events} />
            </div>
          ) : (
            <TranscriptView view={transcript} live={live} />
          )
        ) : unaryTab === "response" ? (
          // CodeBody fills the flex column and scrolls itself; the others need an overflow wrapper.
          <UnaryBody
            error={viewing ? undefined : error}
            message={response?.message}
            tools={codeTools}
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            {unaryTab === "metadata" ? (
              <HeaderTable
                rows={response?.metadata ?? []}
                empty="No metadata"
              />
            ) : unaryTab === "trailers" ? (
              <HeaderTable
                rows={response?.trailers ?? []}
                empty="No trailers"
              />
            ) : (
              <TimelineList events={events} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
