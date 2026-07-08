import { cn } from "@/lib/utils"

export function Section({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[11px]">{children}</div>
}

export function Field({
  label,
  icon,
  required,
  error,
  children,
}: {
  label: string
  icon?: React.ReactNode
  required?: boolean
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-muted/70">
        {icon}
        <span className="text-[0.75rem] font-semibold uppercase tracking-[1.2px]">
          {label}
          {required && <span className="text-accent ml-0.5">*</span>}
        </span>
      </div>
      {children}
      {error && <span className="text-[0.75rem] text-error">{error}</span>}
    </div>
  )
}

export function TextField({
  value,
  onChange,
  onCommit,
  placeholder,
  area = false,
  invalid = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  placeholder?: string
  area?: boolean
  invalid?: boolean
}) {
  const className = cn(
    "w-full bg-bg border rounded-lg text-fg px-2.5 py-2 text-[0.893rem] outline-none focus:ring-3 transition-colors leading-normal",
    invalid
      ? "border-error focus:border-error focus:ring-error/20"
      : "border-border focus:border-accent focus:ring-accent/20",
  )
  return area ? (
    <textarea
      rows={3}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      className={cn(className, "resize-y min-h-[64px]")}
      spellCheck={false}
      autoComplete="off"
    />
  ) : (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      className={className}
      spellCheck={false}
      autoComplete="off"
    />
  )
}
