import type { ApiKeyLocation } from "../../../../../../packages/types/bindings"
import { type FieldsProps, PlainField, SecretField, Segmented } from "./shared"

const LOCATIONS: { value: ApiKeyLocation; label: string }[] = [
  { value: "header", label: "Header" },
  { value: "query", label: "Query" },
]

export function ApiKeyFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"api_key">) {
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
      <Segmented
        label="Add to"
        value={auth.location}
        options={LOCATIONS}
        onChange={(location) =>
          setAuth((p) => (p.kind === "api_key" ? { ...p, location } : p))
        }
      />
    </>
  )
}
