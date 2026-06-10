import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/error"
import { createGitBranch, renameGitBranch } from "@/store/gitBranches"
import type { VoleeoError } from "../../../packages/types/bindings"

function branchError(e: unknown): string {
  if (e instanceof Error) return e.message
  return errorMessage(e as VoleeoError)
}

/** Presentational shell shared by the branch name-entry modals. */
function BranchModalForm({
  titleIcon,
  titleLabel,
  name,
  onNameChange,
  onSubmit,
  helper,
  error,
  saving,
  submitDisabled,
  submitLabel,
  busyLabel,
  onClose,
}: {
  titleIcon: "branch" | "edit"
  titleLabel: string
  name: string
  onNameChange: (name: string) => void
  onSubmit: () => void
  helper: string
  error: string | null
  saving: boolean
  submitDisabled: boolean
  submitLabel: string
  busyLabel: string
  onClose: () => void
}) {
  return (
    <ManagementModal
      title={
        <span className="flex items-center gap-1.5 font-sans text-sm text-fg">
          <Glyph kind={titleIcon} size={14} color="var(--base04)" />{" "}
          {titleLabel}
        </span>
      }
      width={420}
      fitContent
      onClose={onClose}
    >
      <div className="p-4 flex flex-col gap-3 w-full">
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit()
          }}
          placeholder="branch-name"
          className="w-full bg-bg border border-border rounded-md px-2.5 py-1.5 text-sm text-fg font-mono outline-none focus:border-accent"
        />
        <p className="text-[0.72rem] text-muted">{helper}</p>
        {error && <div className="text-[0.78rem] text-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || submitDisabled}
            onClick={onSubmit}
          >
            {saving ? busyLabel : submitLabel}
          </Button>
        </div>
      </div>
    </ManagementModal>
  )
}

export function NewBranchModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    setError(null)
    try {
      await createGitBranch(workspaceId, n)
      onClose()
    } catch (e) {
      setError(branchError(e))
      setSaving(false)
    }
  }

  return (
    <BranchModalForm
      titleIcon="branch"
      titleLabel="New branch"
      name={name}
      onNameChange={setName}
      onSubmit={create}
      helper="Creates the branch at the current commit and switches to it."
      error={error}
      saving={saving}
      submitDisabled={!name.trim()}
      submitLabel="Create branch"
      busyLabel="Creating…"
      onClose={onClose}
    />
  )
}

export function RenameBranchModal({
  workspaceId,
  current,
  onClose,
}: {
  workspaceId: string
  current: string
  onClose: () => void
}) {
  const [name, setName] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function rename() {
    const n = name.trim()
    if (!n || n === current) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await renameGitBranch(workspaceId, current, n)
      onClose()
    } catch (e) {
      setError(branchError(e))
      setSaving(false)
    }
  }

  return (
    <BranchModalForm
      titleIcon="edit"
      titleLabel="Rename branch"
      name={name}
      onNameChange={setName}
      onSubmit={rename}
      helper={`Renames “${current}”. Local only — re-push to update the remote.`}
      error={error}
      saving={saving}
      submitDisabled={!name.trim() || name.trim() === current}
      submitLabel="Rename branch"
      busyLabel="Renaming…"
      onClose={onClose}
    />
  )
}
