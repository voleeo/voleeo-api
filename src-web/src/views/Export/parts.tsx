import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SectionLabel({
  children,
  right,
}: {
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.13em] text-muted">
        {children}
      </span>
      <span className="flex-1" />
      {right}
    </div>
  )
}

export function Meta({
  icon,
  children,
  tone,
}: {
  icon: ReactNode
  children: ReactNode
  tone?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        tone ?? "text-muted",
      )}
    >
      <span className="flex opacity-85">{icon}</span>
      {children}
    </span>
  )
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 text-[11px] font-semibold text-accent">
      {children}
    </span>
  )
}
