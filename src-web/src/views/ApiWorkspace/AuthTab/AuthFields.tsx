import {
  type AuthProtocol,
  authDescription,
  isAuthEnabled,
  isConcreteScheme,
  schemeSupports,
  setAuthEnabled,
} from "@/lib/authSchemes"
import { cn } from "@/lib/utils"
import type { AuthConfig } from "@/store/requests"
import { ApiKeyFields } from "./fields/ApiKeyFields"
import { AwsSigV4Fields } from "./fields/AwsSigV4Fields"
import { BasicFields } from "./fields/BasicFields"
import { BearerFields } from "./fields/BearerFields"
import { OAuth1Fields } from "./fields/OAuth1Fields"
import { OAuth2Fields } from "./fields/OAuth2Fields"
import { AuthToggleButton, WarningBlock } from "./fields/shared"
import type { SetAuth } from "./useAuthEditor"

interface Props {
  auth: AuthConfig
  setAuth: SetAuth
  onVarClick: (varName: string) => void
  protocol?: AuthProtocol
}

function FieldGroup({ auth, setAuth, onVarClick }: Props) {
  switch (auth.kind) {
    case "bearer":
      return (
        <BearerFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    case "basic":
      return (
        <BasicFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    case "api_key":
      return (
        <ApiKeyFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    case "aws_sig_v4":
      return (
        <AwsSigV4Fields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    case "oauth1":
      return (
        <OAuth1Fields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    case "oauth2":
      return (
        <OAuth2Fields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )
    default:
      return null
  }
}

export function AuthFields({ auth, setAuth, onVarClick, protocol }: Props) {
  if (!isConcreteScheme(auth.kind)) return null
  const httpOnly = !protocol && !schemeSupports(auth.kind, "grpc")
  const enabled = isAuthEnabled(auth)
  return (
    <div className="relative flex flex-col gap-4">
      <AuthToggleButton
        enabled={enabled}
        onChange={(next) => setAuth(setAuthEnabled(auth, next))}
      />
      {httpOnly && (
        <WarningBlock className="mr-8">
          <span className="font-semibold">HTTP only.</span> gRPC and WebSocket
          requests won't use this auth.
        </WarningBlock>
      )}
      <p
        className={cn(
          "font-sans text-[0.786rem] text-muted leading-snug",
          !httpOnly && "pr-8",
        )}
      >
        {authDescription(auth.kind)}
      </p>
      <div
        className={cn(
          "flex flex-col gap-4 transition-opacity",
          !enabled && "opacity-45",
        )}
      >
        <FieldGroup auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      </div>
    </div>
  )
}
