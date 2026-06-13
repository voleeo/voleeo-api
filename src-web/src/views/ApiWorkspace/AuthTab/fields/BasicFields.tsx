import { type FieldsProps, PlainField, SecretField } from "./shared"

export function BasicFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"basic">) {
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
