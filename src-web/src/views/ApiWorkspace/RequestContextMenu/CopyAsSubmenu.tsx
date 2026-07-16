import { Glyph } from "@/components/Glyph"
import { ITEM_CLASSES } from "./contextMenuStyles"

export interface CopyAsAction {
  id: string
  label: string
  glyph?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: CopyAsAction[]
  onPick: (actionId: string) => void
}

export function CopyAsSubmenu({ open, onOpenChange, actions, onPick }: Props) {
  if (actions.length === 0) return null
  return (
    <div className="relative">
      <button
        type="button"
        className={ITEM_CLASSES}
        onMouseEnter={() => onOpenChange(true)}
        onFocus={() => onOpenChange(true)}
        onClick={() => onOpenChange(!open)}
      >
        <Glyph kind="copy" size={13} color="var(--base04)" />
        <span className="flex-1 text-left">Copy as ...</span>
        <Glyph kind="chevron" size={11} color="var(--base04)" />
      </button>
      {open && (
        <div
          className="absolute left-full top-0 -ml-px z-[301] min-w-[150px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          onMouseEnter={() => onOpenChange(true)}
        >
          {actions.map((a) => {
            const short = a.label.replace(/^Copy as\s+/i, "")
            return (
              <button
                key={a.id}
                type="button"
                className={ITEM_CLASSES}
                onClick={() => onPick(a.id)}
              >
                <Glyph
                  kind={a.glyph ?? "copy"}
                  size={13}
                  color="var(--base04)"
                />
                <span>{short}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
