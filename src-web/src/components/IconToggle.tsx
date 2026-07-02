import type { ReactNode, Ref } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function IconToggle({
  glyph,
  icon,
  title,
  onClick,
  active = false,
  glyphSize = 13,
  buttonRef,
  className,
}: {
  glyph?: string
  icon?: ReactNode
  title: string
  onClick: () => void
  active?: boolean
  glyphSize?: number
  buttonRef?: Ref<HTMLButtonElement>
  className?: string
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex items-center justify-center size-6 rounded-[6px] cursor-pointer transition-colors border",
        active
          ? "text-accent bg-accent/10 border-accent/40"
          : "text-muted hover:text-fg bg-transparent border-transparent",
        className,
      )}
    >
      {icon ??
        (glyph && <Glyph kind={glyph} size={glyphSize} color="currentColor" />)}
    </button>
  )
}
