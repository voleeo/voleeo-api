import { useRef } from "react"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { GrpcPane } from "@/views/GrpcWorkspace/GrpcPane"
import { GrpcResponsePane } from "@/views/GrpcWorkspace/GrpcResponsePane"
import { WsPane } from "@/views/WsWorkspace/WsPane"
import { WsTranscriptPane } from "@/views/WsWorkspace/WsTranscriptPane"
import { FolderPane } from "./FolderPane"
import { FolderRunPanel } from "./FolderRunPanel"
import { GraphqlDocsRail } from "./GraphqlDocsRail"
import { PaneSeparator } from "./PaneSeparator"
import { RequestPane } from "./RequestPane"
import { RequestTreePane } from "./RequestTreePane"
import { ResponsePane } from "./ResponsePane"
import { usePaneDrag } from "./usePaneDrag"

function EmptyWorkspace() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-8">
      <p className="font-sans text-[1rem] text-fg">No requests yet</p>
      <p className="font-mono text-[0.857rem] text-muted">
        Press{" "}
        <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface font-mono text-[0.857rem] tracking-[0.2em] text-fg">
          {formatKeyCombo(SHORTCUTS.NEW_ITEM)}
        </kbd>{" "}
        to create your first request
      </p>
    </div>
  )
}

export function ApiWorkspace() {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const panelLayout = useUiStore((s) => s.panelLayout)
  const treeVisible = useUiStore((s) => s.treeVisible)
  const togglePanelLayout = useUiStore((s) => s.togglePanelLayout)
  useKeydown(SHORTCUTS.TOGGLE_LAYOUT, togglePanelLayout)

  const hasRequests = useRequestStore((s) => s.requests.length > 0)
  const activeFolderId = useRequestStore((s) => s.activeFolderId)
  const activeConnectionId = useRequestStore((s) => s.activeConnectionId)
  const activeGrpcId = useRequestStore((s) => s.activeGrpcId)
  const wsId = activeWorkspaceId ?? "default"
  const isColumns = panelLayout === "columns"

  // Container refs — each layout passes its own ref to the drag hook
  const colRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const {
    sizes,
    onColSep1Down,
    onColSep2Down,
    onRowOuterSepDown,
    onRowInnerSepDown,
  } = usePaneDrag(wsId, colRef, rowRef, innerRef)

  const layout = isColumns ? (
    <div ref={colRef} className="h-full flex overflow-hidden bg-bg">
      {treeVisible && (
        <>
          <div
            style={{ width: `${sizes.colPane1}%` }}
            className="shrink-0 h-full overflow-hidden"
          >
            <RequestTreePane />
          </div>
          <PaneSeparator dir="col" onMouseDown={onColSep1Down} />
        </>
      )}

      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {activeFolderId ? (
          <FolderPane />
        ) : activeConnectionId ? (
          <WsPane key={activeConnectionId} />
        ) : activeGrpcId ? (
          <GrpcPane key={activeGrpcId} />
        ) : hasRequests ? (
          <RequestPane />
        ) : (
          <EmptyWorkspace />
        )}
      </div>

      <PaneSeparator dir="col" onMouseDown={onColSep2Down} />

      <div
        style={{ width: `${sizes.colPane3}%` }}
        className="shrink-0 h-full overflow-hidden"
      >
        {activeFolderId ? (
          <FolderRunPanel />
        ) : activeConnectionId ? (
          <WsTranscriptPane />
        ) : activeGrpcId ? (
          <GrpcResponsePane key={activeGrpcId} />
        ) : (
          <ResponsePane />
        )}
      </div>
    </div>
  ) : (
    <div ref={rowRef} className="h-full flex overflow-hidden bg-bg">
      {treeVisible && (
        <>
          <div
            style={{ width: `${sizes.rowTree}%` }}
            className="shrink-0 h-full overflow-hidden"
          >
            <RequestTreePane />
          </div>
          <PaneSeparator dir="col" onMouseDown={onRowOuterSepDown} />
        </>
      )}

      <div
        ref={innerRef}
        className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
      >
        {activeFolderId ? (
          <>
            <div
              style={{ height: `${sizes.rowInner}%` }}
              className="shrink-0 w-full overflow-hidden flex flex-col"
            >
              <FolderPane />
            </div>

            <PaneSeparator dir="row" onMouseDown={onRowInnerSepDown} />

            <div className="flex-1 min-h-0 w-full overflow-hidden">
              <FolderRunPanel />
            </div>
          </>
        ) : activeConnectionId ? (
          <>
            <div
              style={{ height: `${sizes.rowInner}%` }}
              className="shrink-0 w-full overflow-hidden flex flex-col"
            >
              <WsPane key={activeConnectionId} />
            </div>

            <PaneSeparator dir="row" onMouseDown={onRowInnerSepDown} />

            <div className="flex-1 min-h-0 w-full overflow-hidden">
              <WsTranscriptPane />
            </div>
          </>
        ) : activeGrpcId ? (
          <>
            <div
              style={{ height: `${sizes.rowInner}%` }}
              className="shrink-0 w-full overflow-hidden flex flex-col"
            >
              <GrpcPane key={activeGrpcId} />
            </div>

            <PaneSeparator dir="row" onMouseDown={onRowInnerSepDown} />

            <div className="flex-1 min-h-0 w-full overflow-hidden">
              <GrpcResponsePane key={activeGrpcId} />
            </div>
          </>
        ) : hasRequests ? (
          <>
            <div
              style={{ height: `${sizes.rowInner}%` }}
              className="shrink-0 w-full overflow-hidden flex flex-col"
            >
              <RequestPane />
            </div>

            <PaneSeparator dir="row" onMouseDown={onRowInnerSepDown} />

            <div className="flex-1 min-h-0 w-full overflow-hidden">
              <ResponsePane />
            </div>
          </>
        ) : (
          <EmptyWorkspace />
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full flex overflow-hidden bg-bg">
      <div className="flex-1 min-w-0 h-full overflow-hidden">{layout}</div>
      <GraphqlDocsRail />
    </div>
  )
}
