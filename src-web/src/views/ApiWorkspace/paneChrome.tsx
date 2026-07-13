import { Glyph } from "@/components/Glyph"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { cn } from "@/lib/utils"

export function EmptyWorkspace() {
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

// Which way a collapsed strip's expand arrow points (toward where it will grow),
// and the border that sits against the neighbouring pane.
const STRIP = {
  left: { glyph: "arrow-line-right", border: "border-r border-border" },
  right: { glyph: "arrow-line-left", border: "border-l border-border" },
  top: { glyph: "arrow-line-down", border: "border-b border-border" },
  bottom: { glyph: "arrow-line-up", border: "border-t border-border" },
} as const

/** A pane collapsed to a thin strip; the button expands it back. `side` is where
 *  the strip sits, so the arrow points the way it will grow. */
export function CollapsedPaneStrip({
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

export function NoSelection() {
  return (
    <div className="h-full flex items-center justify-center text-center px-8">
      <p className="font-mono text-[0.857rem] text-muted">Select a request</p>
    </div>
  )
}
