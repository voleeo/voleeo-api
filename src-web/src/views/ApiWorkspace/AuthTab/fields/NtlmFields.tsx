import { type FieldsProps, HelpText, PlainField, SecretField } from "./shared"

export function NtlmFields({ auth, setAuth, onVarClick }: FieldsProps<"ntlm">) {
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "ntlm" ? { ...p, [key]: value } : p))

  return (
    <>
      <PlainField
        label="Username"
        value={auth.username}
        placeholder="Username (or DOMAIN\\username)"
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
      <div className="grid grid-cols-2 gap-3">
        <PlainField
          label="Domain"
          value={auth.domain ?? ""}
          placeholder="Optional"
          onChange={(v) => set("domain", v)}
          onVarClick={onVarClick}
        />
        <PlainField
          label="Workstation"
          value={auth.workstation ?? ""}
          placeholder="Optional"
          onChange={(v) => set("workstation", v)}
          onVarClick={onVarClick}
        />
      </div>
      <HelpText>
        Voleeo runs the NTLMv2 handshake over a dedicated connection at send
        time. Scoped to HTTP/1.1 — no redirects mid-handshake, no proxy, and the
        cookie jar isn't applied.
      </HelpText>
    </>
  )
}
