import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { BodyKind } from "./useBodyEditor"

interface BodyKindGroup {
  label?: string
  items: { kind: BodyKind; label: string }[]
}

const BODY_KIND_GROUPS: BodyKindGroup[] = [
  {
    label: "Text",
    items: [
      { kind: "json", label: "JSON" },
      { kind: "xml", label: "XML" },
      { kind: "html", label: "HTML" },
      { kind: "text", label: "Text" },
    ],
  },
  { label: "Query", items: [{ kind: "graphql", label: "GraphQL" }] },
  {
    label: "Form",
    items: [
      { kind: "form_url_encoded", label: "URL Encoded" },
      { kind: "multipart", label: "Multipart" },
    ],
  },
  {
    label: "Other",
    items: [
      { kind: "none", label: "No Body" },
      { kind: "binary", label: "Binary" },
    ],
  },
]

const BODY_KINDS = BODY_KIND_GROUPS.flatMap((g) => g.items)

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
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {BODY_KIND_GROUPS.map((group) => (
          <div key={group.label ?? group.items[0].kind}>
            {group.label && (
              <div className="px-2 pt-2 pb-1 font-mono text-[0.72rem] uppercase tracking-wider text-muted">
                {group.label}
              </div>
            )}
            {group.items.map((b) => {
              const active = b.kind === bodyKind
              return (
                <DropdownMenuItem
                  key={b.kind}
                  className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[16px_1fr] items-center gap-2"
                  onClick={() => {
                    if (!active) onChange(b.kind)
                  }}
                >
                  <span className="flex items-center justify-center">
                    {active && (
                      <Glyph kind="check" size={11} color="var(--base04)" />
                    )}
                  </span>
                  <span>{b.label}</span>
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
