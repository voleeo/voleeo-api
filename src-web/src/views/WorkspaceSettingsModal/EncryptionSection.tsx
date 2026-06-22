import { useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { commands } from "../../../../packages/types/bindings"
import { ImportKeyForm } from "./ImportKeyForm"

interface EncryptionSectionProps {
  workspaceId: string
  encrypted: boolean
  onEncryptionChanged: () => void
}

export function EncryptionSection({
  workspaceId,
  encrypted,
  onEncryptionChanged,
}: EncryptionSectionProps) {
  const [isEncrypted, setIsEncrypted] = useState(encrypted)
  const [hasKey, setHasKey] = useState(false)
  const [keyString, setKeyString] = useState<string | null>(null)
  const [keyVisible, setKeyVisible] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isEncrypted) return
    commands.workspaceHasKey(workspaceId).then((res) => {
      if (res.status === "ok") setHasKey(res.data)
    })
  }, [workspaceId, isEncrypted])

  async function loadKey(): Promise<string | null> {
    if (keyString) return keyString
    const res = await commands.workspaceGetKeyDisplay(workspaceId)
    if (res.status === "ok") {
      setKeyString(res.data)
      return res.data
    }
    setKeyError("Encryption key not found for this workspace. Import it below.")
    return null
  }

  async function handleEnable() {
    setEnabling(true)
    setEnableError(null)
    try {
      const res = await commands.workspaceEnableEncryption(workspaceId)
      if (res.status === "ok") {
        setKeyString(res.data)
        setKeyVisible(true)
        setIsEncrypted(true)
        setHasKey(true)
        onEncryptionChanged()
      } else {
        setEnableError(errorMessage(res.error))
      }
    } finally {
      setEnabling(false)
    }
  }

  async function toggleReveal() {
    setKeyError(null)
    if (keyVisible) return setKeyVisible(false)
    if (await loadKey()) setKeyVisible(true)
  }

  async function copyKey() {
    setKeyError(null)
    const key = keyString ?? (await loadKey())
    if (!key) return
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Glyph kind="lock" size={13} color="var(--base04)" />
        <span className="font-sans text-[0.929rem] font-semibold text-fg flex-1">
          Encryption
        </span>
        {isEncrypted ? (
          <span className="flex items-center gap-1 text-[0.714rem] px-2 py-0.5 rounded-full bg-success/15 text-success">
            <Glyph kind="check" size={11} color="var(--base0B)" />
            Enabled
          </span>
        ) : (
          <Button
            size="sm"
            onClick={handleEnable}
            disabled={enabling}
            className="cursor-pointer gap-1.5"
          >
            {enabling ? (
              <Spinner className="size-3.5 shrink-0" />
            ) : (
              <Glyph kind="lock" size={13} color="currentColor" />
            )}
            {enabling ? "Encrypting" : "Encrypt"}
          </Button>
        )}
      </div>

      {!isEncrypted ? (
        <div className="border border-border rounded-[8px] p-4 flex flex-col gap-3">
          <p className="font-sans text-[0.857rem] text-muted leading-relaxed">
            Sensitive values stored in this workspace are encrypted at rest
            using <span className="text-fg font-medium">AES-256-GCM</span>. The
            key lives in your OS keychain, with a copy you can save externally.
          </p>
          {enableError && (
            <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-1.5">
              {enableError}
            </div>
          )}
        </div>
      ) : hasKey ? (
        <div className="border border-border rounded-[8px] bg-bg overflow-hidden">
          <div className="px-4 pt-3 pb-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Glyph kind="key" size={13} color="var(--base0D)" />
              <span className="font-sans text-[0.857rem] font-semibold text-fg flex-1">
                Encryption key
              </span>
              <button
                type="button"
                onClick={toggleReveal}
                title={keyVisible ? "Hide key" : "Reveal key"}
                className="p-1.5 cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none rounded-[4px] transition-colors"
              >
                <Glyph
                  kind={keyVisible ? "hide" : "view"}
                  size={13}
                  color="var(--base04)"
                />
              </button>
              <button
                type="button"
                onClick={copyKey}
                title="Copy encryption key"
                className="p-1.5 cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none rounded-[4px] transition-colors"
              >
                <Glyph
                  kind={copied ? "check" : "copy"}
                  size={13}
                  color={copied ? "var(--base0B)" : "var(--base04)"}
                />
              </button>
            </div>
            <input
              readOnly
              type={keyVisible ? "text" : "password"}
              value={keyString ?? "placeholder-key-for-masking-dots"}
              className="w-full px-3 py-2 border border-border rounded-[6px] bg-surface font-mono text-[0.786rem] text-fg outline-none select-text"
            />
            {keyError && (
              <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-1.5 leading-relaxed">
                {keyError}
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3 flex items-center gap-3">
            <div className="shrink-0 size-8 rounded-[7px] bg-(--base0A)/15 flex items-center justify-center">
              <Glyph kind="shield-check" size={16} color="var(--base0A)" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[0.857rem] font-semibold text-fg">
                Back up your key
              </div>
              <p className="text-[0.75rem] text-muted leading-relaxed">
                Save this key outside your keychain. If the keychain is cleared
                or you switch machines, it's the only way to recover your
                encrypted secrets.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ImportKeyForm
          workspaceId={workspaceId}
          onImported={() => {
            setHasKey(true)
            setKeyString(null)
            setKeyVisible(false)
            setKeyError(null)
          }}
        />
      )}
    </div>
  )
}
