import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function CopyButton({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const [done, setDone] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text).catch(() => {})
    setDone(true)
    setTimeout(() => setDone(false), 1200)
  }
  return (
    <button
      type="button"
      title={done ? "Copied" : "Copy"}
      aria-label="Copy"
      onClick={copy}
      className={cn(
        "p-1 rounded-[3px] border bg-bg cursor-pointer transition-colors",
        done
          ? "text-success border-success/40"
          : "text-muted border-border hover:text-fg hover:border-fg/30",
        className,
      )}
    >
      <Glyph kind={done ? "check" : "copy"} size={13} color="currentColor" />
    </button>
  )
}
