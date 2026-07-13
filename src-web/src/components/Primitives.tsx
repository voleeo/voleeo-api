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

export function Heading({
  children,
  size = 20,
  weight = 600,
  color = "var(--base05)",
  style = {},
}: {
  children: ReactNode
  size?: number
  weight?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <div
      className="font-sans leading-tight tracking-[-0.2px]"
      style={{ fontSize: size, fontWeight: weight, color, ...style }}
    >
      {children}
    </div>
  )
}

export function Body({
  children,
  size = 13,
  color = "var(--base04)",
  style = {},
}: {
  children: ReactNode
  size?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <div
      className="font-sans leading-relaxed"
      style={{ fontSize: size, color, ...style }}
    >
      {children}
    </div>
  )
}

export function Btn({
  children,
  primary = false,
  small = false,
  disabled = false,
  style = {},
  onClick,
}: {
  children: ReactNode
  primary?: boolean
  small?: boolean
  disabled?: boolean
  style?: CSSProperties
  onClick?: () => void
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded whitespace-nowrap font-sans font-medium border",
        small ? "px-2.5 py-[5px] text-[0.786rem]" : "px-3.5 py-2 text-xs",
        disabled ? "opacity-40 cursor-default" : "cursor-pointer",
        primary
          ? "border-fg bg-fg text-bg"
          : "border-border bg-surface text-fg",
      ].join(" ")}
      style={style}
    >
      {children}
    </div>
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
