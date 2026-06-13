import { type FieldsProps, SecretField } from "./shared"

export function BearerFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"bearer">) {
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
