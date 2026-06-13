import { cn } from "@/lib/utils"
import type { OAuth2Grant } from "../../../../../../../packages/types/bindings"
import type { FieldsProps } from "../shared"
import { EndpointFields } from "./EndpointFields"
import { TokenPanel } from "./TokenPanel"

const GRANTS: { value: OAuth2Grant; label: string }[] = [
  { value: "client_credentials", label: "Client Credentials" },
  { value: "authorization_code", label: "Authorization Code" },
  { value: "password", label: "Password" },
]

export function OAuth2Fields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth2">) {
  const grant = auth.grant_type ?? "client_credentials"
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-sans text-[0.857rem] text-muted shrink-0">
          Grant
        </span>
        <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px] flex-wrap">
          {GRANTS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() =>
                setAuth((p) =>
                  p.kind === "oauth2" ? { ...p, grant_type: g.value } : p,
                )
              }
              className={cn(
                "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
                grant === g.value
                  ? "bg-accent/15 text-accent"
                  : "bg-transparent text-muted hover:text-fg",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <EndpointFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      <TokenPanel auth={auth} />
    </>
  )
}
