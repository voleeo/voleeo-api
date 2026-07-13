import { useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { cn } from "@/lib/utils"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { GrpcPane } from "@/views/GrpcWorkspace/GrpcPane"
import { GrpcResponsePane } from "@/views/GrpcWorkspace/GrpcResponsePane"
import { WsPane } from "@/views/WsWorkspace/WsPane"
import { WsTranscriptPane } from "@/views/WsWorkspace/WsTranscriptPane"
import { DebugInfoModal } from "./DebugInfoModal"
import { FolderPane } from "./FolderPane"
import { FolderRunPanel } from "./FolderRunPanel"
import { GraphqlDocsRail } from "./GraphqlDocsRail"
import { PaneSeparator } from "./PaneSeparator"
import { RequestPane } from "./RequestPane"
import { RequestTreePane } from "./RequestTreePane"
import { ResponsePane } from "./ResponsePane"
import { SnapshotResponsePane, SnapshotView } from "./SnapshotView"
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

const STRIP = {
  left: { glyph: "arrow-line-right", border: "border-r border-border" },
  right: { glyph: "arrow-line-left", border: "border-l border-border" },
  top: { glyph: "arrow-line-down", border: "border-b border-border" },
  bottom: { glyph: "arrow-line-up", border: "border-t border-border" },
} as const

function CollapsedPaneStrip({
  side,
  onExpand,
}: {
  side: keyof typeof STRIP
  onExpand: () => void
}) {
  const vertical = side === "left" || side === "right"
  return (
    <div
      className={cn(
        "shrink-0 flex bg-bg",
        vertical
          ? "w-8 h-full items-start justify-center pt-2.5"
          : "h-8 w-full items-center justify-start pl-2.5",
        STRIP[side].border,
      )}
    >
      <button
        type="button"
        title="Expand pane"
        onClick={onExpand}
        className="p-1 rounded text-muted hover:text-fg hover:bg-subtle cursor-pointer"
      >
        <Glyph kind={STRIP[side].glyph} size={16} />
      </button>
    </div>
  )
}

function NoSelection() {
  return (
    <div className="h-full flex items-center justify-center text-center px-8">
      <p className="font-mono text-[0.857rem] text-muted">Select a request</p>
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
  const activeRequestId = useRequestStore((s) => s.activeRequestId)
  const activeFolderId = useRequestStore((s) => s.activeFolderId)
  const activeConnectionId = useRequestStore((s) => s.activeConnectionId)
  const activeGrpcId = useRequestStore((s) => s.activeGrpcId)
  const activeSnapshotId = useRequestStore((s) => s.activeSnapshotId)
  const wsId = activeWorkspaceId ?? "default"
  const isColumns = panelLayout === "columns"

  // Which of the center/response panes is collapsed to a thin strip (columns layout only)
  const [collapsed, setCollapsed] = useState<"none" | "center" | "response">(
    "none",
  )

  // An open snapshot renders only when no other entity is active — same lowest
  // precedence as its slot in the center chain (see requests store types).
  const showSnapshot = Boolean(
    activeSnapshotId &&
      !activeFolderId &&
      !activeConnectionId &&
      !activeGrpcId &&
      !activeRequestId,
  )

  // The request/response chrome (URL bar, tabs, response pane) only renders when
  // something is selected; otherwise the center shows a bare placeholder.
  const hasSelection = Boolean(
    activeFolderId ||
      activeConnectionId ||
      activeGrpcId ||
      activeRequestId ||
      showSnapshot,
  )

  useKeydown(SHORTCUTS.TOGGLE_REQUEST_PANE, () => {
    if (hasSelection) setCollapsed((c) => (c === "center" ? "none" : "center"))
  })
  useKeydown(SHORTCUTS.TOGGLE_RESPONSE_PANE, () => {
    if (hasSelection)
      setCollapsed((c) => (c === "response" ? "none" : "response"))
  })

  const center = activeFolderId ? (
    <FolderPane />
  ) : activeConnectionId ? (
    <WsPane key={activeConnectionId} />
  ) : activeGrpcId ? (
    <GrpcPane key={activeGrpcId} />
  ) : activeRequestId ? (
    <RequestPane />
  ) : showSnapshot ? (
    <SnapshotView key={activeSnapshotId} />
  ) : hasRequests ? (
    <NoSelection />
  ) : (
    <EmptyWorkspace />
  )

  const responsePane = activeFolderId ? (
    <FolderRunPanel />
  ) : activeConnectionId ? (
    <WsTranscriptPane />
  ) : activeGrpcId ? (
    <GrpcResponsePane key={activeGrpcId} />
  ) : showSnapshot ? (
    <SnapshotResponsePane key={activeSnapshotId} />
  ) : (
    <ResponsePane />
  )

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
    onColSep1DoubleClick,
    onColSep2DoubleClick,
    onRowOuterDoubleClick,
    onRowInnerDoubleClick,
  } = usePaneDrag(wsId, colRef, rowRef, innerRef, setCollapsed)

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
          <PaneSeparator
            dir="col"
            onMouseDown={onColSep1Down}
            onDoubleClick={onColSep1DoubleClick}
          />
        </>
      )}

      {hasSelection && collapsed === "center" ? (
        <CollapsedPaneStrip side="left" onExpand={() => setCollapsed("none")} />
      ) : (
        <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
          {center}
        </div>
      )}

      {hasSelection && collapsed === "response" && (
        <CollapsedPaneStrip
          side="right"
          onExpand={() => setCollapsed("none")}
        />
      )}

      {hasSelection && collapsed === "none" && (
        <>
          <PaneSeparator
            dir="col"
            onMouseDown={onColSep2Down}
            onDoubleClick={onColSep2DoubleClick}
            onCollapseLeft={() => setCollapsed("center")}
            onCollapseRight={() => setCollapsed("response")}
          />
          <div
            style={{ width: `${sizes.colPane3}%` }}
            className="shrink-0 h-full overflow-hidden"
          >
            {responsePane}
          </div>
        </>
      )}

      {hasSelection && collapsed === "center" && (
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {responsePane}
        </div>
      )}
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
          <PaneSeparator
            dir="col"
            onMouseDown={onRowOuterSepDown}
            onDoubleClick={onRowOuterDoubleClick}
          />
        </>
      )}

      <div
        ref={innerRef}
        className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
      >
        {hasSelection ? (
          <>
            {collapsed === "center" ? (
              <CollapsedPaneStrip
                side="top"
                onExpand={() => setCollapsed("none")}
              />
            ) : (
              <div
                style={
                  collapsed === "response"
                    ? undefined
                    : { height: `${sizes.rowInner}%` }
                }
                className={cn(
                  "w-full overflow-hidden flex flex-col",
                  collapsed === "response" ? "flex-1 min-h-0" : "shrink-0",
                )}
              >
                {center}
              </div>
            )}

            {collapsed === "none" && (
              <PaneSeparator
                dir="row"
                onMouseDown={onRowInnerSepDown}
                onDoubleClick={onRowInnerDoubleClick}
                onCollapseLeft={() => setCollapsed("center")}
                onCollapseRight={() => setCollapsed("response")}
              />
            )}

            {collapsed === "response" ? (
              <CollapsedPaneStrip
                side="bottom"
                onExpand={() => setCollapsed("none")}
              />
            ) : (
              <div className="flex-1 min-h-0 w-full overflow-hidden">
                {responsePane}
              </div>
            )}
          </>
        ) : (
          center
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full flex overflow-hidden bg-bg">
      <div className="flex-1 min-w-0 h-full overflow-hidden">{layout}</div>
      <GraphqlDocsRail />
      <DebugInfoModal />
    </div>
  )
}
