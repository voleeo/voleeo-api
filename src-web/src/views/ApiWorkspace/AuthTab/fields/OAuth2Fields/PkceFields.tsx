import { Checkbox } from "@/components/ui/checkbox"
import type { OAuth2PkceMethod } from "../../../../../../../packages/types/bindings"
import { type FieldsProps, LabeledDropdown, PlainField } from "../shared"

const METHODS: { value: OAuth2PkceMethod; label: string }[] = [
  { value: "s256", label: "SHA-256 (default)" },
  { value: "plain", label: "Plain" },
]

export function PkceFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth2">) {
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "oauth2" ? { ...p, [key]: value } : p))
  const enabled = auth.use_pkce ?? true

  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit items-center gap-2 cursor-pointer font-sans text-[0.857rem] text-fg">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => set("use_pkce", v === true)}
        />
        Use PKCE
      </label>
      {enabled && (
        <>
          <LabeledDropdown
            label="Code Challenge Method"
            value={auth.code_challenge_method ?? "s256"}
            options={METHODS}
            onChange={(v) => set("code_challenge_method", v)}
          />
          <PlainField
            label="Code Verifier"
            value={auth.code_verifier ?? ""}
            placeholder="Automatically generated when not set"
            onChange={(v) => set("code_verifier", v)}
            onVarClick={onVarClick}
          />
        </>
      )}
    </div>
  )
}
