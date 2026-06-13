import { type FieldsProps, HelpText, PlainField, SecretField } from "./shared"

export function AwsSigV4Fields({
  auth,
  setAuth,
  onVarClick,
}: FieldsProps<"aws_sig_v4">) {
  return (
    <>
      <PlainField
        label="Access Key ID"
        value={auth.access_key}
        placeholder="AKIA…"
        onChange={(access_key) =>
          setAuth((p) => (p.kind === "aws_sig_v4" ? { ...p, access_key } : p))
        }
        onVarClick={onVarClick}
      />
      <SecretField
        label="Secret Access Key"
        value={auth.secret_key}
        placeholder="Secret access key"
        encrypted={auth.secret_key_encrypted ?? false}
        onChange={(secret_key) =>
          setAuth((p) => (p.kind === "aws_sig_v4" ? { ...p, secret_key } : p))
        }
        onEncryptedChange={(secret_key_encrypted) =>
          setAuth((p) =>
            p.kind === "aws_sig_v4" ? { ...p, secret_key_encrypted } : p,
          )
        }
        onVarClick={onVarClick}
      />
      <div className="flex flex-col gap-1">
        <SecretField
          label="Session Token"
          value={auth.session_token ?? ""}
          placeholder="Optional"
          encrypted={auth.session_token_encrypted ?? false}
          onChange={(session_token) =>
            setAuth((p) =>
              p.kind === "aws_sig_v4" ? { ...p, session_token } : p,
            )
          }
          onEncryptedChange={(session_token_encrypted) =>
            setAuth((p) =>
              p.kind === "aws_sig_v4" ? { ...p, session_token_encrypted } : p,
            )
          }
          onVarClick={onVarClick}
        />
        <HelpText>Only for temporary STS credentials.</HelpText>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PlainField
          label="Region"
          value={auth.region}
          placeholder="us-east-1"
          onChange={(region) =>
            setAuth((p) => (p.kind === "aws_sig_v4" ? { ...p, region } : p))
          }
          onVarClick={onVarClick}
        />
        <PlainField
          label="Service"
          value={auth.service}
          placeholder="execute-api"
          onChange={(service) =>
            setAuth((p) => (p.kind === "aws_sig_v4" ? { ...p, service } : p))
          }
          onVarClick={onVarClick}
        />
      </div>
    </>
  )
}
