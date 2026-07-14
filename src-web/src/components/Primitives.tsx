import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function MonoLabel({
  children,
  color = "var(--base04)",
  size = 11,
  style = {},
}: {
  children: ReactNode
  color?: string
  size?: number
  style?: CSSProperties
}) {
  return (
    <span
      className="uppercase tracking-[0.3px] whitespace-nowrap"
      style={{ fontSize: size, color, ...style }}
    >
      {children}
    </span>
  )
}

export function TabItem({
  label,
  active,
  onClick,
}: {
  label: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div
      role={onClick ? "tab" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "px-2.5 pt-[9px] pb-2 text-[0.714rem] tracking-[0.3px] whitespace-nowrap shrink-0",
        onClick ? "cursor-pointer" : "cursor-default",
        active
          ? "border-b-[1.5px] border-fg text-fg font-semibold"
          : "border-b-[1.5px] border-transparent text-muted font-normal",
      )}
    >
      {label}
    </div>
  )
}
