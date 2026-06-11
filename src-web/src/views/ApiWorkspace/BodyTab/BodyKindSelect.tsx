import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { BodyKind } from "./useBodyEditor"

// Grouped: none · raw · form/multipart · binary — separators sit between groups.
const BODY_KIND_GROUPS: { kind: BodyKind; label: string }[][] = [
  [{ kind: "none", label: "No Body" }],
  [
    { kind: "json", label: "JSON" },
    { kind: "xml", label: "XML" },
    { kind: "html", label: "HTML" },
    { kind: "text", label: "Text" },
  ],
  [
    { kind: "form_url_encoded", label: "Form URL Encoded" },
    { kind: "multipart", label: "Multipart Form" },
  ],
  [{ kind: "binary", label: "Binary" }],
]

const BODY_KINDS = BODY_KIND_GROUPS.flat()

interface Props {
  bodyKind: BodyKind
  onChange: (kind: BodyKind) => void
}

export function BodyKindSelect({ bodyKind, onChange }: Props) {
  const activeLabel =
    BODY_KINDS.find((b) => b.kind === bodyKind)?.label ?? "No Body"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "px-2.5 pt-[9px] pb-2 font-sans text-[0.857rem] leading-none flex items-center gap-1 cursor-pointer outline-none transition-colors",
          bodyKind === "none"
            ? "text-muted hover:text-fg"
            : "text-accent hover:text-accent/80",
        )}
      >
        {activeLabel}
        <Glyph kind="chevron" size={11} color="currentColor" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {BODY_KIND_GROUPS.map((group, i) => (
          <div key={group[0].kind}>
            {i > 0 && <DropdownMenuSeparator />}
            {group.map((b) => {
              const active = b.kind === bodyKind
              return (
                <DropdownMenuItem
                  key={b.kind}
                  className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
                  onClick={() => {
                    if (!active) onChange(b.kind)
                  }}
                >
                  <span>{b.label}</span>
                  <span className="flex items-center justify-center">
                    {active && (
                      <Glyph kind="check" size={11} color="var(--base04)" />
                    )}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
