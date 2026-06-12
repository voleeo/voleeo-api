import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  Badge,
  badgeColor,
  badgeLabel,
  DismissLayer,
  HighlightMatch,
} from "./AutocompleteUtils"
import {
  type AutocompleteItem,
  buildItems,
  type ConstantSuggestion,
  deriveNamespaces,
} from "./autocompleteItems"

// Re-exported so existing importers of these from "./Autocomplete" keep working.
export type { AutocompleteItem, ConstantSuggestion }
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
              <Row
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

function Row({
  item,
  query,
  index,
  selected,
  onSelect,
}: {
  item: AutocompleteItem
  query: string
  index: number
  selected: boolean
  onSelect: (item: AutocompleteItem) => void
}) {
  return (
    <div
      data-ac-index={index}
      className={cn(
        "flex items-center gap-2 px-2.5 py-[5px] cursor-pointer select-none",
        selected ? "bg-subtle" : "hover:bg-subtle/60",
      )}
      onClick={() => onSelect(item)}
    >
      {item.kind === "var" && (
        <>
          <Badge letter="v" color="var(--base0C)" />
          <span className="font-mono text-[11px] text-fg flex-1 truncate">
            <HighlightMatch text={item.name} query={query} />
          </span>
        </>
      )}
      {item.kind === "func" && (
        <>
          <Badge letter="f" color="var(--base0D)" />
          <div className="flex flex-col flex-1 min-w-0">
            <span className="font-mono text-[11px] text-fg truncate">
              <HighlightMatch text={item.fn.name} query={query} />
            </span>
            {item.fn.label && (
              <span className="font-sans text-[10px] text-muted truncate">
                {item.fn.label}
              </span>
            )}
          </div>
        </>
      )}
      {item.kind === "namespace" && (
        <>
          <Badge letter="n" color="var(--base0A)" />
          <span className="font-mono text-[11px] text-fg flex-1 truncate">
            <HighlightMatch text={item.prefix} query={query} />
            .*
          </span>
        </>
      )}
      {item.kind === "schema" && (
        <>
          <Badge letter="g" color="var(--base0F)" />
          <span className="font-mono text-[11px] text-fg flex-1 truncate">
            <HighlightMatch text={item.label} query={query} />
          </span>
          {item.detail && (
            <span className="font-mono text-[10px] text-muted shrink-0 italic">
              {item.detail}
            </span>
          )}
        </>
      )}
      {item.kind === "constant" && (
        <>
          <Badge letter={item.badge} color={badgeColor(item.badge)} />
          <div className="flex flex-col flex-1 min-w-0">
            <span className="font-mono text-[11px] text-fg truncate">
              <HighlightMatch text={item.value} query={query} />
            </span>
            {item.description && (
              <span className="font-sans text-[10px] text-muted truncate">
                {item.description}
              </span>
            )}
          </div>
          <span className="font-sans text-[10px] text-muted shrink-0">
            {badgeLabel(item.badge)}
          </span>
        </>
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

function itemKey(item: AutocompleteItem, i: number): string {
  if (item.kind === "var") return `var:${item.name}`
  if (item.kind === "func") return `func:${item.fn.name}`
  if (item.kind === "constant") return `const:${item.value}:${i}`
  if (item.kind === "schema") return `schema:${item.label}:${i}`
  return `ns:${item.prefix}:${i}`
}
