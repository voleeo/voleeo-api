import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { type FieldsProps, PlainField } from "../shared"

export function OAuth1Advanced({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth1">) {
  const [open, setOpen] = useState(false)
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "oauth1" ? { ...p, [key]: value } : p))

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 self-start font-sans text-[0.857rem] text-muted hover:text-fg cursor-pointer outline-none transition-colors"
      >
        <Glyph
          kind={open ? "chevron-down" : "chevron"}
          size={11}
          color="currentColor"
        />
        Advanced
      </button>
      <div className={cn("flex-col gap-3", open ? "flex" : "hidden")}>
        <PlainField
          label="Callback URL"
          value={auth.callback ?? ""}
          placeholder="oauth_callback (request-token step)"
          onChange={(v) => set("callback", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Verifier"
          value={auth.verifier ?? ""}
          placeholder="oauth_verifier (access-token step)"
          onChange={(v) => set("verifier", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Timestamp"
          value={auth.timestamp ?? ""}
          placeholder="Auto"
          onChange={(v) => set("timestamp", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Nonce"
          value={auth.nonce ?? ""}
          placeholder="Auto"
          onChange={(v) => set("nonce", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Version"
          value={auth.version ?? ""}
          placeholder="1.0"
          onChange={(v) => set("version", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Realm"
          value={auth.realm ?? ""}
          placeholder="Optional"
          onChange={(v) => set("realm", v)}
          onVarClick={onVarClick}
        />
      </div>
    </div>
  )
}
