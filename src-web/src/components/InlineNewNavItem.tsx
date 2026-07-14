import { useState } from "react"
import { cn } from "@/lib/utils"

interface Props {
  placeholder: string
  /** Tailwind class for the leading dot (e.g. "bg-accent"). */
  dotClassName?: string
  /** Inline background for the leading dot when it isn't a Tailwind color. */
  dotColor?: string
  /** Create from the trimmed name; return true if handled, false to cancel. */
  onCommit: (name: string) => Promise<boolean>
  onCancel: () => void
}

/** Inline "new item" row shared by the environments and cookies sidebars — a
 *  leading dot + autofocused input that commits on Enter/blur, cancels on
 *  Escape or an empty name. Each caller supplies its own store call via
 *  `onCommit`. */
export function InlineNewNavItem({
  placeholder,
  dotClassName,
  dotColor,
  onCommit,
  onCancel,
}: Props) {
  const [name, setName] = useState("")

  async function commit() {
    const trimmed = name.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    if (!(await onCommit(trimmed))) onCancel()
  }

  return (
    <div className="flex items-center gap-2 mx-2 px-2 py-[6px] rounded-md bg-accent/10 w-[calc(100%-16px)]">
      <span
        className={cn(
          "w-3 h-3 rounded-full shrink-0 ring-1 ring-border",
          dotClassName,
        )}
        style={dotColor ? { background: dotColor } : undefined}
      />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") onCancel()
        }}
        onBlur={commit}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className="font-sans text-[0.929rem] text-fg bg-transparent border-0 outline-none flex-1 min-w-0 placeholder:text-muted/50 select-text"
      />
    </div>
  )
}
