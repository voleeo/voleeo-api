import { type ReactNode, useEffect } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

interface Props {
  title: ReactNode
  headerActions?: ReactNode
  width?: number
  bodyClassName?: string
  fitContent?: boolean
  onClose: () => void
  children: ReactNode
}

export function ManagementModal({
  title,
  headerActions,
  width = 780,
  bodyClassName,
  fitContent,
  onClose,
  children,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-200 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        style={{ width }}
        className={cn(
          "bg-surface border border-border rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.6)] max-w-[96vw] flex flex-col overflow-hidden transition-[width] duration-200 ease-out",
          fitContent ? "h-auto max-h-[88vh]" : "h-[80vh]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {title}
          </div>
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[3px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none"
          >
            <Glyph kind="x" size={13} color="var(--base04)" />
          </button>
        </div>
        <div className={cn("flex flex-1 min-h-0", bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  )
}
