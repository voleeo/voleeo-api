import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function FormatCard({
  icon,
  name,
  version,
  desc,
  selected,
  onSelect,
}: {
  icon: ReactNode
  name: string
  version: string
  desc: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-1 cursor-pointer flex-col gap-3 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-accent/45 bg-accent/10"
          : "border-border bg-bg/40 hover:border-[var(--base03)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[11px] border",
            selected
              ? "border-accent/30 bg-accent/15 text-accent"
              : "border-border bg-surface text-muted",
          )}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="text-[15px] font-semibold text-fg">{name}</span>
          <span
            className={cn(
              "font-mono text-xs font-semibold",
              selected ? "text-accent" : "text-muted",
            )}
          >
            {version}
          </span>
        </div>
      </div>
      <div className="min-h-[2.6rem] whitespace-pre-line text-[12.5px] leading-relaxed text-muted">
        {desc}
      </div>
    </button>
  )
}
