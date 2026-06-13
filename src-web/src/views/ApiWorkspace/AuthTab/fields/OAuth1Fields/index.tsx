import type {
  OAuth1Location,
  OAuth1Signature,
} from "../../../../../../../packages/types/bindings"
import {
  type FieldsProps,
  HelpText,
  LabeledDropdown,
  PlainField,
  SecretField,
  Segmented,
} from "../shared"
import { OAuth1Advanced } from "./OAuth1Advanced"

const SIGNATURE_METHODS: { value: OAuth1Signature; label: string }[] = [
  { value: "hmac_sha1", label: "HMAC-SHA1" },
  { value: "hmac_sha256", label: "HMAC-SHA256" },
  { value: "hmac_sha512", label: "HMAC-SHA512" },
  { value: "rsa_sha1", label: "RSA-SHA1" },
  { value: "rsa_sha256", label: "RSA-SHA256" },
  { value: "rsa_sha512", label: "RSA-SHA512" },
  { value: "plain_text", label: "PLAINTEXT" },
]

const LOCATIONS: { value: OAuth1Location; label: string }[] = [
  { value: "header", label: "Header" },
  { value: "query", label: "Query" },
]

export function OAuth1Fields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"oauth1">) {
  const method = auth.signature_method ?? "hmac_sha1"
  const isRsa = method.startsWith("rsa_")
  const set = <K extends keyof typeof auth>(key: K, value: (typeof auth)[K]) =>
    setAuth((p) => (p.kind === "oauth1" ? { ...p, [key]: value } : p))

  return (
    <>
      <LabeledDropdown
        label="Signature Method"
        value={method}
        options={SIGNATURE_METHODS}
        mono
        onChange={(v) => set("signature_method", v)}
      />
      <PlainField
        label="Consumer Key"
        value={auth.consumer_key}
        placeholder="Consumer key"
        onChange={(v) => set("consumer_key", v)}
        onVarClick={onVarClick}
      />
      <SecretField
        label="Consumer Secret"
        value={auth.consumer_secret}
        placeholder="Consumer secret"
        encrypted={auth.consumer_secret_encrypted ?? false}
        onChange={(v) => set("consumer_secret", v)}
        onEncryptedChange={(v) => set("consumer_secret_encrypted", v)}
        onVarClick={onVarClick}
      />
      <div className="flex flex-col gap-1">
        <PlainField
          label="Token"
          value={auth.token ?? ""}
          placeholder="Access token"
          onChange={(v) => set("token", v)}
          onVarClick={onVarClick}
        />
        <HelpText>Leave token and secret empty for a two-legged flow.</HelpText>
      </div>
      <SecretField
        label="Token Secret"
        value={auth.token_secret ?? ""}
        placeholder="Token secret"
        encrypted={auth.token_secret_encrypted ?? false}
        onChange={(v) => set("token_secret", v)}
        onEncryptedChange={(v) => set("token_secret_encrypted", v)}
        onVarClick={onVarClick}
      />
      {isRsa && (
        <SecretField
          label="Private Key (PEM)"
          value={auth.private_key ?? ""}
          placeholder="-----BEGIN PRIVATE KEY-----"
          encrypted={auth.private_key_encrypted ?? false}
          onChange={(v) => set("private_key", v)}
          onEncryptedChange={(v) => set("private_key_encrypted", v)}
          onVarClick={onVarClick}
        />
      )}
      <Segmented
        label="Add to"
        value={auth.params_location ?? "header"}
        options={LOCATIONS}
        onChange={(v) => set("params_location", v)}
      />
      <OAuth1Advanced auth={auth} setAuth={setAuth} onVarClick={onVarClick} />
    </>
  )
}
