import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { Button } from "@/components/ui/button"
import { useGitStore } from "@/store/git"
import {
  clearGitCredentials,
  loadGitSettings,
  saveGitCredentials,
  saveGitIdentity,
} from "@/store/gitSettings"

const INPUT =
  "w-full bg-bg border border-border rounded-md px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"

// These are identifiers, not prose — keep the OS/browser from rewriting them.
const NO_AUTOCORRECT = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

interface Props {
  onClose: () => void
  message?: string | null
}

export function GitSettings({ onClose, message }: Props) {
  const workspaceId = useGitStore((s) => s.loadedWorkspaceId)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [token, setToken] = useState("")
  const [hasCreds, setHasCreds] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    loadGitSettings(workspaceId)
      .then((s) => {
        setName(s.identity?.name ?? "")
        setEmail(s.identity?.email ?? "")
        setUsername(s.credentialsUser ?? "")
        setHasCreds(s.credentialsUser != null)
      })
      .catch(() => {})
  }, [workspaceId])

  async function save() {
    if (!workspaceId) return
    setSaving(true)
    setError(null)
    try {
      if (name.trim() && email.trim()) {
        await saveGitIdentity(workspaceId, name.trim(), email.trim())
      }
      if (username.trim() && token.trim()) {
        await saveGitCredentials(workspaceId, username.trim(), token.trim())
      }
      await useGitStore.getState().load(workspaceId)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  async function clearCreds() {
    if (!workspaceId) return
    await clearGitCredentials(workspaceId)
    setUsername("")
    setToken("")
    setHasCreds(false)
  }

  return (
    <ManagementModal
      title={
        <span className="flex items-center gap-1.5 font-sans text-sm text-fg">
          <Glyph kind="settings" size={14} color="var(--base04)" /> Git settings
        </span>
      }
      width={460}
      fitContent
      onClose={onClose}
    >
      <div className="p-4 flex flex-col gap-4 w-full">
        {message && (
          <div className="flex gap-2 text-[0.78rem] text-fg bg-warn/10 border border-warn/40 rounded-md px-2.5 py-2">
            <Glyph kind="warning" size={15} color="var(--base0A)" />
            <span>{message}</span>
          </div>
        )}
        <Section title="Commit author">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className={INPUT}
              {...NO_AUTOCORRECT}
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className={INPUT}
              {...NO_AUTOCORRECT}
            />
          </div>
          <p className="text-[0.72rem] text-muted">
            Saved to this repo's git config and used for your commits.
          </p>
        </Section>

        <Section title="HTTPS credentials">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className={INPUT}
            {...NO_AUTOCORRECT}
          />
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder={
              hasCreds
                ? "•••••• (leave blank to keep)"
                : "Personal access token"
            }
            className={INPUT}
            {...NO_AUTOCORRECT}
          />
          <p className="text-[0.72rem] text-muted">
            Used for push/pull over HTTPS, stored locally (secrets.json, mode
            0600). For GitHub use a personal access token. SSH remotes use your
            agent instead.
          </p>
          {hasCreds && (
            <button
              type="button"
              onClick={clearCreds}
              className="text-[0.72rem] text-error hover:underline self-start cursor-pointer"
            >
              Remove stored credentials
            </button>
          )}
        </Section>

        {error && (
          <div className="text-[0.78rem] text-error bg-error/10 border border-error/30 rounded-md px-2.5 py-1.5">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="cursor-pointer border-border text-fg bg-transparent hover:bg-subtle hover:text-fg"
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="cursor-pointer">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </ManagementModal>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.72rem] uppercase tracking-wide text-muted font-medium">
        {title}
      </span>
      {children}
    </div>
  )
}
