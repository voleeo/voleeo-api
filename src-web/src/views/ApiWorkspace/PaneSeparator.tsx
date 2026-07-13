import { Glyph } from "@/components/Glyph"

interface Props {
  dir: "col" | "row"
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onCollapseLeft?: () => void
  onCollapseRight?: () => void
}

function CollapseBtn({
  glyph,
  title,
  onClick,
}: {
  glyph: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      // Stop mousedown from starting a drag on the separator.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="p-0.5 rounded bg-surface border border-border text-muted hover:text-fg hover:bg-subtle cursor-pointer"
    >
      <Glyph kind={glyph} size={14} />
    </button>
  )
}

/** Thin separator between panes. The container stays a fixed 1px so the hover
 *  highlight never shifts adjacent content — the visible line and the wider hit
 *  area are absolutely-positioned overlays centered on it. */
export function PaneSeparator({
  dir,
  onMouseDown,
  onDoubleClick,
  onCollapseLeft,
  onCollapseRight,
}: Props) {
  if (dir === "col") {
    const hasCollapse = onCollapseLeft || onCollapseRight
    return (
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="relative z-10 w-px shrink-0 cursor-col-resize overflow-visible select-none group"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:w-[4px] group-hover:bg-accent/70 transition-all" />
        <div className="absolute inset-y-0 -left-[4px] -right-[4px]" />
        {hasCollapse && (
          <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-20 flex gap-[6px] opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity">
            {onCollapseLeft && (
              <CollapseBtn
                glyph="arrow-line-left"
                title="Collapse left pane"
                onClick={onCollapseLeft}
              />
            )}
            {onCollapseRight && (
              <CollapseBtn
                glyph="arrow-line-right"
                title="Collapse right pane"
                onClick={onCollapseRight}
              />
            )}
          </div>
        )}
      </div>
    )
  }
  const hasCollapse = onCollapseLeft || onCollapseRight
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className="relative z-10 h-px w-full shrink-0 cursor-row-resize overflow-visible select-none group"
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border group-hover:h-[4px] group-hover:bg-accent/70 transition-all" />
      <div className="absolute inset-x-0 -top-[4px] -bottom-[4px]" />
      {hasCollapse && (
        <div className="absolute right-[12px] top-1/2 -translate-y-1/2 z-20 flex gap-[6px] opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity">
          {onCollapseLeft && (
            <CollapseBtn
              glyph="arrow-line-up"
              title="Collapse top pane"
              onClick={onCollapseLeft}
            />
          )}
          {onCollapseRight && (
            <CollapseBtn
              glyph="arrow-line-down"
              title="Collapse bottom pane"
              onClick={onCollapseRight}
            />
          )}
        </div>
      )}
    </div>
  )
}
