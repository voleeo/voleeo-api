import { cn } from "@/lib/utils"
import type { RunStrategy } from "@/store/folderRun"

const OPTIONS: { value: RunStrategy; label: string }[] = [
  { value: "sequential", label: "Sequential" },
  { value: "parallel", label: "Parallel" },
]

export function FolderRunStrategyToggle({
  value,
  disabled,
  onChange,
}: {
  value: RunStrategy
  disabled: boolean
  onChange: (next: RunStrategy) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {OPTIONS.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
              active
                ? "bg-accent/15 text-accent"
                : "bg-transparent text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
