import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { OAuth2Grant } from "../../../../../../../packages/types/bindings"
import type { FieldsProps } from "../shared"
import { EndpointFields } from "./EndpointFields"
import { TokenPanel } from "./TokenPanel"

const GRANTS: { value: OAuth2Grant; label: string }[] = [
  { value: "client_credentials", label: "Client Credentials" },
  { value: "authorization_code", label: "Authorization Code" },
  { value: "implicit", label: "Implicit" },
  { value: "password", label: "Password" },
]

export function OAuth2Fields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth2">) {
  const grant = auth.grant_type ?? "client_credentials"
  const grantLabel = GRANTS.find((g) => g.value === grant)?.label ?? "Grant"
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-sans text-[0.857rem] text-muted shrink-0">
          Grant
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 font-sans text-[0.857rem] text-fg cursor-pointer outline-none hover:text-accent transition-colors">
            {grantLabel}
            <Glyph kind="chevron" size={11} color="currentColor" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[170px]">
            {GRANTS.map((g) => {
              const active = g.value === grant
              return (
                <DropdownMenuItem
                  key={g.value}
                  className="font-sans text-[0.857rem] focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
                  onClick={() => {
                    if (!active)
                      setAuth((p) =>
                        p.kind === "oauth2" ? { ...p, grant_type: g.value } : p,
                      )
                  }}
                >
                  <span>{g.label}</span>
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
      </div>
      <EndpointFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      <TokenPanel auth={auth} />
    </>
  )
}
