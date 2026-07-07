import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function ToggleRow({
  label,
  desc,
  on,
  onChange,
}: {
  label: string
  desc: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Don't double-toggle when the click hit the Switch — it already
        // fires `onCheckedChange` on its own.
        const t = e.target as HTMLElement
        if (t.closest('[data-slot="switch"]')) return
        onChange(!on)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onChange(!on)
        }
      }}
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer bg-bg border border-border rounded-lg hover:border-muted/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[0.893rem] font-medium text-fg">{label}</div>
        <div className="text-[0.786rem] text-muted/70 mt-[1.5px] leading-snug">
          {desc}
        </div>
      </div>
      <Switch
        size="sm"
        checked={on}
        onCheckedChange={(next) => onChange(next === true)}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ label: string; value: T }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex bg-bg border border-border rounded-lg p-0.5 gap-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 px-2 py-[5px] rounded-[5px] border-0 cursor-pointer text-[0.786rem] tracking-[0.2px] transition-colors",
              active
                ? "bg-subtle text-fg font-semibold"
                : "bg-transparent text-muted/80 hover:text-fg",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
