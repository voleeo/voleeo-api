import { Glyph } from "@/components/Glyph"
import { SearchField } from "@/components/SearchField"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { SseView } from "./useSseView"

export function SseFilterPane({ view }: { view: SseView }) {
  const { filter, setFilter, query, setQuery, types, total } = view
  const activeCount =
    filter === "all"
      ? total
      : (types.find((t) => t.type === filter)?.count ?? 0)

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border shrink-0">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Filter events"
        className="flex-1 min-w-[160px]"
        autoFocus
        onClear={() => view.setSearchOpen(false)}
      />

      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[8px] cursor-pointer border border-border bg-surface hover:bg-subtle transition-colors outline-none font-mono text-[0.786rem]">
          <span className="font-semibold text-fg">{filter}</span>
          <span className="text-muted/60">{activeCount}</span>
          <Glyph kind="chevron-down" size={12} color="var(--base04)" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <FilterItem
            label="all"
            count={total}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {types.map((t) => (
            <FilterItem
              key={t.type}
              label={t.type}
              count={t.count}
              active={filter === t.type}
              onClick={() => setFilter(t.type)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function FilterItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className="cursor-pointer focus:bg-subtle flex items-center gap-2 py-1.5 font-mono text-[0.786rem]"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {active && <Glyph kind="check" size={13} color="var(--base0D)" />}
      </span>
      <span
        className={cn(
          "flex-1 font-semibold",
          active ? "text-accent" : "text-fg",
        )}
      >
        {label}
      </span>
      <span className="text-muted/60">{count}</span>
    </DropdownMenuItem>
  )
}
