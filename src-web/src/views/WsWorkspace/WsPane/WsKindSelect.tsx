import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type WsMessageUiKind = "json" | "xml" | "text"

const WS_KINDS: { kind: WsMessageUiKind; label: string }[] = [
  { kind: "json", label: "JSON" },
  { kind: "xml", label: "XML" },
  { kind: "text", label: "Text" },
]

interface Props {
  kind: WsMessageUiKind
  onChange: (kind: WsMessageUiKind) => void
}

export function WsKindSelect({ kind, onChange }: Props) {
  const activeLabel = WS_KINDS.find((k) => k.kind === kind)?.label ?? "Text"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "px-2.5 pt-[9px] pb-2 font-sans text-[0.857rem] leading-none flex items-center gap-1 cursor-pointer outline-none transition-colors",
          "text-accent hover:text-accent/80",
        )}
      >
        {activeLabel}
        <Glyph kind="chevron" size={11} color="currentColor" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[100px]">
        {WS_KINDS.map((k) => {
          const active = k.kind === kind
          return (
            <DropdownMenuItem
              key={k.kind}
              className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
              onClick={() => {
                if (!active) onChange(k.kind)
              }}
            >
              <span>{k.label}</span>
              <span className="flex items-center justify-center">
                {active && (
                  <Glyph kind="check" size={11} color="var(--base04)" />
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
