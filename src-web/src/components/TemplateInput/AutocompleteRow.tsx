import { cn } from "@/lib/utils"
import {
  Badge,
  badgeColor,
  badgeLabel,
  HighlightMatch,
} from "./AutocompleteUtils"
import type { AutocompleteItem } from "./autocompleteItems"

export function AutocompleteRow({
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
          {item.system && (
            <span className="font-sans text-[10px] text-muted shrink-0">
              system
            </span>
          )}
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

export function itemKey(item: AutocompleteItem, i: number): string {
  if (item.kind === "var") return `var:${item.name}`
  if (item.kind === "func") return `func:${item.fn.name}`
  if (item.kind === "constant") return `const:${item.value}:${i}`
  if (item.kind === "schema") return `schema:${item.label}:${i}`
  return `ns:${item.prefix}:${i}`
}
