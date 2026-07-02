import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function Dot({
  color = "var(--base04)",
  size = 16,
  className,
}: {
  color?: string
  size?: number
  className?: string
}) {
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <Glyph kind="dot-outline" weight="fill" size={size} color={color} />
    </span>
  )
}
