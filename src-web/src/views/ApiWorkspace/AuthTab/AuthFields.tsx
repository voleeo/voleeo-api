import type { ReactNode } from "react"
import { EncryptedInput } from "@/components/EncryptedInput"
import { TemplateInput } from "@/components/TemplateInput"
import { cn } from "@/lib/utils"
import type { AuthConfig } from "@/store/requests"
import type { SetAuth } from "./useAuthEditor"

interface Props {
  auth: AuthConfig
  setAuth: SetAuth
  onVarClick: (varName: string) => void
}

function FieldShell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[0.714rem] uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="border border-border rounded-[4px] bg-surface px-1.5 py-1 focus-within:border-accent transition-colors">
        {children}
      </div>
    </div>
  )
}

function PlainField({
  label,
  value,
  placeholder,
  onChange,
  onVarClick,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onVarClick: (varName: string) => void
}) {
  return (
    <FieldShell label={label}>
      <TemplateInput
        value={value}
        onChange={onChange}
        onVarClick={onVarClick}
        placeholder={placeholder}
        className="w-full"
      />
    </FieldShell>
  )
}

function SecretField({
  label,
  value,
  placeholder,
  encrypted,
  onChange,
  onEncryptedChange,
  onVarClick,
}: {
  label: string
  value: string
  placeholder: string
  encrypted: boolean
  onChange: (v: string) => void
  onEncryptedChange: (next: boolean) => void
  onVarClick: (varName: string) => void
}) {
  return (
    <FieldShell label={label}>
      <EncryptedInput
        value={value}
        onChange={onChange}
        encrypted={encrypted}
        onEncryptedChange={onEncryptedChange}
        onVarClick={onVarClick}
        placeholder={placeholder}
        secret
      />
    </FieldShell>
  )
}

export function AuthFields({ auth, setAuth, onVarClick }: Props) {
  if (auth.kind === "bearer") {
    return (
      <SecretField
        label="Token"
        value={auth.token}
        placeholder="Token"
        encrypted={auth.token_encrypted ?? false}
        onChange={(token) =>
          setAuth((p) => (p.kind === "bearer" ? { ...p, token } : p))
        }
        onEncryptedChange={(token_encrypted) =>
          setAuth((p) => (p.kind === "bearer" ? { ...p, token_encrypted } : p))
        }
        onVarClick={onVarClick}
      />
    )
  }

  if (auth.kind === "basic") {
    return (
      <>
        <PlainField
          label="Username"
          value={auth.username}
          placeholder="Username"
          onChange={(username) =>
            setAuth((p) => (p.kind === "basic" ? { ...p, username } : p))
          }
          onVarClick={onVarClick}
        />
        <SecretField
          label="Password"
          value={auth.password}
          placeholder="Password"
          encrypted={auth.password_encrypted ?? false}
          onChange={(password) =>
            setAuth((p) => (p.kind === "basic" ? { ...p, password } : p))
          }
          onEncryptedChange={(password_encrypted) =>
            setAuth((p) =>
              p.kind === "basic" ? { ...p, password_encrypted } : p,
            )
          }
          onVarClick={onVarClick}
        />
      </>
    )
  }

  if (auth.kind !== "api_key") return null

  return (
    <>
      <PlainField
        label="Key"
        value={auth.key}
        placeholder="Header / param name"
        onChange={(key) =>
          setAuth((p) => (p.kind === "api_key" ? { ...p, key } : p))
        }
        onVarClick={onVarClick}
      />
      <SecretField
        label="Value"
        value={auth.value}
        placeholder="Value"
        encrypted={auth.value_encrypted ?? false}
        onChange={(value) =>
          setAuth((p) => (p.kind === "api_key" ? { ...p, value } : p))
        }
        onEncryptedChange={(value_encrypted) =>
          setAuth((p) => (p.kind === "api_key" ? { ...p, value_encrypted } : p))
        }
        onVarClick={onVarClick}
      />
      <div className="flex items-center gap-3">
        <span className="font-sans text-[0.857rem] text-muted">Add to</span>
        <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]">
          {(["header", "query"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() =>
                setAuth((p) =>
                  p.kind === "api_key" ? { ...p, location: loc } : p,
                )
              }
              className={cn(
                "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors capitalize",
                auth.location === loc
                  ? "bg-accent/15 text-accent"
                  : "bg-transparent text-muted hover:text-fg",
              )}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
