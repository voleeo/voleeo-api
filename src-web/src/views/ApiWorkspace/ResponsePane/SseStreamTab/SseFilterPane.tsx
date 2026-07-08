import { Glyph } from "@/components/Glyph"
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
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface">
      <Glyph kind="search" size={12} color="var(--base04)" />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && view.setSearchOpen(false)}
        placeholder="Filter events"
        autoComplete="off"
        spellCheck={false}
        className="flex-1 bg-transparent border-none outline-none font-mono text-[0.786rem] text-fg placeholder:text-muted"
      />

      {types.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-[3px] cursor-pointer border border-border bg-transparent hover:border-fg/30 transition-colors outline-none font-mono text-[0.714rem]">
            <span className="font-semibold text-fg">{filter}</span>
            <span className="text-muted/60">{activeCount}</span>
            <Glyph kind="chevron-down" size={11} color="var(--base04)" />
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
      )}

      <button
        type="button"
        onClick={() => view.setSearchOpen(false)}
        className="flex items-center justify-center w-4 h-4 rounded-[2px] border-0 bg-transparent outline-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
      >
        <Glyph kind="x" size={10} color="var(--base04)" />
      </button>
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
