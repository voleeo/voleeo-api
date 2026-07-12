import { useEffect, useRef } from "react"
import { AutocompleteRow, itemKey } from "./AutocompleteRow"
import { DismissLayer } from "./AutocompleteUtils"
import {
  type AutocompleteItem,
  buildItems,
  type ConstantSuggestion,
  deriveNamespaces,
  type VarSuggestion,
} from "./autocompleteItems"

// Re-exported so existing importers of these from "./Autocomplete" keep working.
export type { AutocompleteItem, ConstantSuggestion, VarSuggestion }
export { buildItems, deriveNamespaces }

interface Props {
  items: AutocompleteItem[]
  selectedIndex: number
  anchorRect: DOMRect
  query: string
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
}

const GROUP_LABEL: Record<AutocompleteItem["kind"], string> = {
  var: "Variables",
  func: "Functions",
  namespace: "Namespaces",
  constant: "Suggestions",
  schema: "Schema",
}

interface Group {
  kind: AutocompleteItem["kind"]
  entries: { item: AutocompleteItem; index: number }[]
}

/** Bucket the flat (already kind-ordered) item list into contiguous groups,
 *  preserving each item's flat index for keyboard selection. */
function groupItems(items: AutocompleteItem[]): Group[] {
  const groups: Group[] = []
  items.forEach((item, index) => {
    const last = groups[groups.length - 1]
    if (last && last.kind === item.kind) last.entries.push({ item, index })
    else groups.push({ kind: item.kind, entries: [{ item, index }] })
  })
  return groups
}

export function Autocomplete({
  items,
  selectedIndex,
  anchorRect,
  query,
  onSelect,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll the highlighted row into view when keyboard navigation moves it.
  // Headers aren't selectable, so target the row by its flat data-index.
  useEffect(() => {
    const el = containerRef.current?.querySelector(
      `[data-ac-index="${selectedIndex}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (items.length === 0) return null

  const style: React.CSSProperties = {
    position: "fixed",
    top: anchorRect.bottom + 2,
    left: anchorRect.left,
    minWidth: Math.max(anchorRect.width, 260),
    zIndex: 300,
  }

  return (
    <div
      ref={containerRef}
      style={style}
      className="bg-surface border border-border rounded-[6px] shadow-[0_4px_20px_rgba(0,0,0,0.5)] flex flex-col max-h-[320px] overflow-hidden"
      // Prevent the input from losing focus when the user clicks inside the dropdown.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {groupItems(items).map((group) => (
          <div key={group.kind}>
            <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
              <span className="font-sans text-[10px] uppercase tracking-[1.2px] text-muted/70 font-semibold">
                {GROUP_LABEL[group.kind]}
              </span>
              <span className="flex-1 h-px bg-border/60" />
              <span className="font-mono text-[10px] text-muted/50">
                {group.entries.length}
              </span>
            </div>
            {group.entries.map(({ item, index }) => (
              <AutocompleteRow
                key={itemKey(item, index)}
                item={item}
                query={query}
                index={index}
                selected={index === selectedIndex}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>

      <Footer />

      {/* Dismiss on click outside */}
      {typeof window !== "undefined" && (
        <DismissLayer containerRef={containerRef} onDismiss={onClose} />
      )}
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[4px] border border-border bg-bg font-mono text-[10px] text-muted">
      {children}
    </span>
  )
}

function Footer() {
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5 border-t border-border shrink-0">
      <span className="flex items-center gap-1">
        <Key>↑</Key>
        <Key>↓</Key>
        <span className="font-sans text-[10px] text-muted">navigate</span>
      </span>
      <span className="flex items-center gap-1">
        <Key>↵</Key>
        <span className="font-sans text-[10px] text-muted">insert</span>
      </span>
      <span className="flex items-center gap-1">
        <Key>esc</Key>
        <span className="font-sans text-[10px] text-muted">dismiss</span>
      </span>
    </div>
  )
}
