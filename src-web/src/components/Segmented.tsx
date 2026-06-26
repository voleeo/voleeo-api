import { cn } from "@/lib/utils"

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-center gap-3">
      {label && (
        <span className="font-sans text-[0.857rem] text-muted">{label}</span>
      )}
      <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
              value === o.value
                ? "bg-accent/15 text-accent"
                : "bg-transparent text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
