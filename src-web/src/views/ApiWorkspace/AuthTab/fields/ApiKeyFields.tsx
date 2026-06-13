import { cn } from "@/lib/utils"
import { type FieldsProps, PlainField, SecretField } from "./shared"

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
