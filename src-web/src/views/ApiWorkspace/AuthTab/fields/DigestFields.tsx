import { type FieldsProps, HelpText, PlainField, SecretField } from "./shared"

export function DigestFields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"digest">) {
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "digest" ? { ...p, [key]: value } : p))

  return (
    <>
      <PlainField
        label="Username"
        value={auth.username}
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
      <HelpText>
        Voleeo answers the server's digest challenge automatically — one extra
        round-trip on the first send. Realm, nonce, and algorithm come from the
        server.
      </HelpText>
    </>
  )
}
