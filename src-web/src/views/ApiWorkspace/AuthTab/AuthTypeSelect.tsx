import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  type AuthKind,
  type AuthProtocol,
  authLabel,
  freshAuth,
  SELECTABLE_AUTH_KINDS,
  schemeSupports,
} from "@/lib/authSchemes"
import { cn } from "@/lib/utils"
import type { AuthConfig } from "@/store/requests"

interface Props {
  auth: AuthConfig
  onChange: (next: AuthConfig) => void
  allowInherit?: boolean
  protocol?: AuthProtocol
}

export function AuthTypeSelect({
  auth,
  onChange,
  allowInherit = false,
  protocol,
}: Props) {
  const kinds: AuthKind[] = [
    ...SELECTABLE_AUTH_KINDS.filter(
      (k) => !protocol || schemeSupports(k, protocol),
    ),
    ...(allowInherit ? (["inherit"] as AuthKind[]) : []),
  ]
  const activeLabel = kinds.includes(auth.kind)
    ? authLabel(auth.kind)
    : authLabel("none")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "px-2.5 pt-[9px] pb-2 font-sans text-[0.857rem] leading-none flex items-center gap-1 cursor-pointer outline-none transition-colors",
          auth.kind === "none"
            ? "text-muted hover:text-fg"
            : "text-accent hover:text-accent/80",
        )}
      >
        {activeLabel}
        <Glyph kind="chevron" size={11} color="currentColor" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[170px]">
        {kinds.map((kind) => {
          const active = kind === auth.kind
          return (
            <DropdownMenuItem
              key={kind}
              className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
              onClick={() => {
                if (!active) onChange(freshAuth(kind))
              }}
            >
              <span>{authLabel(kind)}</span>
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
