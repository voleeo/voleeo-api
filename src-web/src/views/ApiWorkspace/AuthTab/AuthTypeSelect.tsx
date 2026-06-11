import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { AuthConfig } from "@/store/requests"

type AuthKind = AuthConfig["kind"]

const BASE_AUTH_TYPES: { kind: AuthKind; label: string }[] = [
  { kind: "none", label: "No Auth" },
  { kind: "basic", label: "Basic Auth" },
  { kind: "bearer", label: "Bearer Token" },
  { kind: "api_key", label: "API Key" },
]

const INHERIT_TYPE = {
  kind: "inherit" as AuthKind,
  label: "Inherit",
}

/** A blank config for a kind — used when the user switches auth type. */
function freshAuth(kind: AuthKind): AuthConfig {
  switch (kind) {
    case "bearer":
      return { kind: "bearer", token: "" }
    case "basic":
      return { kind: "basic", username: "", password: "" }
    case "api_key":
      return { kind: "api_key", key: "", value: "", location: "header" }
    case "inherit":
      return { kind: "inherit", from: "folder" }
    default:
      return { kind: "none" }
  }
}

interface Props {
  auth: AuthConfig
  onChange: (next: AuthConfig) => void
  allowInherit?: boolean
}

export function AuthTypeSelect({
  auth,
  onChange,
  allowInherit = false,
}: Props) {
  const types = allowInherit
    ? [...BASE_AUTH_TYPES, INHERIT_TYPE]
    : BASE_AUTH_TYPES
  const activeLabel =
    types.find((t) => t.kind === auth.kind)?.label ?? "No Auth"

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
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {types.map((t) => {
          const active = t.kind === auth.kind
          return (
            <DropdownMenuItem
              key={t.kind}
              className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
              onClick={() => {
                if (!active) onChange(freshAuth(t.kind))
              }}
            >
              <span>{t.label}</span>
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
