import type { ReactNode } from "react"
import { Glyph } from "@/components/Glyph"

interface Props {
  fnName: string
  description: string
  canInsert: boolean
  onInsert: () => void
  onClose: () => void
  children: ReactNode
}

/** Shared chrome for the template-function modals: backdrop, header, footer.
 * Each modal supplies its own form fields + preview as `children`. */
export function FunctionModalShell({
  fnName,
  description,
  canInsert,
  onInsert,
  onClose,
  children,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-300 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.6)] w-[460px] max-w-[96vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
          <span
            className="font-mono text-[0.714rem] font-bold w-5 h-5 flex items-center justify-center rounded-[4px] shrink-0"
            style={{
              background: "color-mix(in srgb,var(--base0D) 15%,transparent)",
              color: "var(--base0D)",
            }}
          >
            f
          </span>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="font-mono text-[0.857rem] text-fg font-semibold truncate">
              {fnName}
            </span>
            <span className="font-sans text-[0.786rem] text-muted truncate">
              {description}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[3px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none shrink-0"
          >
            <Glyph kind="x" size={13} color="var(--base04)" />
          </button>
        </div>

        {children}

        <div className="px-4 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[5px] font-sans text-[0.857rem] text-muted border border-border bg-transparent hover:bg-subtle cursor-pointer outline-none transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onInsert}
            disabled={!canInsert}
            className="px-3 py-1.5 rounded-[5px] font-sans text-[0.857rem] font-medium border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed outline-none transition-colors"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
