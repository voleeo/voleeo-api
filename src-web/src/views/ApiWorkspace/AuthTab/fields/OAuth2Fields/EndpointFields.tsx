import { cn } from "@/lib/utils"
import type { OAuth2ClientAuth } from "../../../../../../../packages/types/bindings"
import { type FieldsProps, PlainField, SecretField } from "../shared"
import { PkceFields } from "./PkceFields"

const CLIENT_AUTH: { value: OAuth2ClientAuth; label: string }[] = [
  { value: "basic_header", label: "Basic header" },
  { value: "request_body", label: "Request body" },
]

/** Grant-aware endpoint + credential fields for OAuth 2.0. */
export function EndpointFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth2">) {
  const grant = auth.grant_type ?? "client_credentials"
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "oauth2" ? { ...p, [key]: value } : p))

  return (
    <>
      {grant === "authorization_code" && (
        <PlainField
          label="Authorization URL"
          value={auth.auth_url ?? ""}
          placeholder="https://provider.com/authorize"
          onChange={(v) => set("auth_url", v)}
          onVarClick={onVarClick}
        />
      )}
      <PlainField
        label="Access Token URL"
        value={auth.token_url}
        placeholder="https://provider.com/oauth/token"
        onChange={(v) => set("token_url", v)}
        onVarClick={onVarClick}
      />
      <PlainField
        label="Client ID"
        value={auth.client_id}
        placeholder="Client ID"
        onChange={(v) => set("client_id", v)}
        onVarClick={onVarClick}
      />
      <SecretField
        label="Client Secret"
        value={auth.client_secret ?? ""}
        placeholder="Client secret"
        encrypted={auth.client_secret_encrypted ?? false}
        onChange={(v) => set("client_secret", v)}
        onEncryptedChange={(v) => set("client_secret_encrypted", v)}
        onVarClick={onVarClick}
      />
      {grant === "password" && (
        <>
          <PlainField
            label="Username"
            value={auth.username ?? ""}
            placeholder="Username"
            onChange={(v) => set("username", v)}
            onVarClick={onVarClick}
          />
          <SecretField
            label="Password"
            value={auth.password ?? ""}
            placeholder="Password"
            encrypted={auth.password_encrypted ?? false}
            onChange={(v) => set("password", v)}
            onEncryptedChange={(v) => set("password_encrypted", v)}
            onVarClick={onVarClick}
          />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <PlainField
          label="Scope"
          value={auth.scope ?? ""}
          placeholder="read write"
          onChange={(v) => set("scope", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Audience"
          value={auth.audience ?? ""}
          placeholder="Optional"
          onChange={(v) => set("audience", v)}
          onVarClick={onVarClick}
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-sans text-[0.857rem] text-muted">
          Client auth
        </span>
        <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]">
          {CLIENT_AUTH.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => set("client_auth", c.value)}
              className={cn(
                "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
                (auth.client_auth ?? "basic_header") === c.value
                  ? "bg-accent/15 text-accent"
                  : "bg-transparent text-muted hover:text-fg",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {grant === "authorization_code" && (
        <PkceFields auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
      )}
    </>
  )
}
