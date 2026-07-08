import { type ReactNode, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function SectionLabel({
  children,
  count,
  trailing,
  noDivider,
}: {
  children: string
  count?: number
  trailing?: ReactNode
  noDivider?: boolean
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-sans text-[0.714rem] uppercase tracking-[1.4px] text-muted/70 font-semibold">
        {children}
      </span>
      {count != null && (
        <span className="font-mono text-[0.714rem] text-muted/70">{count}</span>
      )}
      {trailing}
      {!noDivider && <span className="flex-1 h-px bg-border" />}
    </div>
  )
}

export function FormatBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-px font-mono text-[0.643rem] uppercase tracking-[0.5px] font-bold rounded-[3px] border border-accent/30 text-accent bg-accent/10">
      {kind}
    </span>
  )
}

export function Line({
  name,
  value,
  sub,
  secret,
  defaultMasked,
}: {
  name: string
  value: string
  sub?: ReactNode
  secret?: boolean
  defaultMasked?: boolean
}) {
  const [show, setShow] = useState(false)
  const hidden = secret && defaultMasked && !show
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-[5px]">
      <div className="font-mono text-[0.857rem] font-semibold text-fg break-words min-w-0">
        {name}
      </div>
      <div className="flex flex-col gap-[2px] min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={cn(
              "flex-1 min-w-0 font-mono text-[0.857rem] text-muted break-all leading-[1.5]",
              hidden && "tracking-[1px]",
            )}
          >
            {hidden ? "••••••••••••••••" : value || "—"}
          </span>
          {secret && defaultMasked && (
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="text-muted/70 hover:text-fg rounded-[3px] cursor-pointer outline-none border-0 bg-transparent shrink-0 w-5 h-5 inline-flex items-center justify-center"
              aria-label={show ? "Hide value" : "Reveal value"}
            >
              <Glyph
                kind={show ? "hide" : "view"}
                size={11}
                color="currentColor"
              />
            </button>
          )}
        </div>
        {sub && (
          <div className="font-mono text-[0.714rem] text-muted/70">{sub}</div>
        )}
      </div>
    </div>
  )
}

export function EmptyHint({ children }: { children: string }) {
  return (
    <div className="font-sans text-[0.857rem] text-muted/70 py-1">
      {children}
    </div>
  )
}
