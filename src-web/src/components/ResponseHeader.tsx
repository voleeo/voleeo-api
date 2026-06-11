import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function ResponseHeader({
  children,
  trailing,
}: {
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="px-3.5 py-2.5 border-b border-border flex items-center gap-3 min-h-[40px] shrink-0">
      {children}
      <div className="flex-1" />
      {trailing}
    </div>
  )
}

export function StatusPill({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "px-2 py-[3px] border rounded-[3px] font-mono text-[0.786rem] font-bold shrink-0 flex items-center gap-1.5 bg-surface",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function HistoryTag() {
  return (
    <span className="px-1.5 py-[2px] rounded-[3px] bg-accent/10 text-accent text-[0.679rem] font-mono uppercase tracking-wide shrink-0">
      history
    </span>
  )
}
