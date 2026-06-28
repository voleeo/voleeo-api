import { emit } from "@tauri-apps/api/event"
import { useCallback, useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { EVENTS } from "@/config/events"
import { errorMessage } from "@/lib/error"
import type { Workspace } from "@/store/workspace"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"

export function DeleteWorkspaceDialog({
  workspace,
  requestCount,
  onCancel,
}: {
  workspace: Workspace
  requestCount: number
  onCancel: () => void
}) {
  const loadWorkspaces = useUiStore((s) => s.loadWorkspaces)
  const [typed, setTyped] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function copyName() {
    navigator.clipboard.writeText(workspace.name).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const confirmed = typed === workspace.name
  const disabled = deleting || !confirmed

  const handleDelete = useCallback(async () => {
    if (disabled) return
    setDeleting(true)
    setError(null)
    try {
      const res = await commands.deleteWorkspace(workspace.id)
      if (res.status === "ok") {
        await loadWorkspaces()
        await emit(EVENTS.workspaceClose, {})
      } else {
        setError(errorMessage(res.error))
        setDeleting(false)
      }
    } catch {
      setError("Unexpected error. Please try again.")
      setDeleting(false)
    }
  }, [disabled, workspace.id, loadWorkspaces])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      } else if (e.key === "Enter" && !disabled) {
        e.preventDefault()
        handleDelete()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [disabled, onCancel, handleDelete])

  const created = new Date(workspace.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const meta = `${requestCount} request${requestCount === 1 ? "" : "s"} · Created ${created}`

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="font-sans bg-surface border border-border rounded-[8px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] w-[480px] max-w-[94vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-center gap-3 border-b border-border">
          <div className="shrink-0 size-9 rounded-[8px] bg-error/10 border border-error/30 flex items-center justify-center">
            <Glyph kind="warning" size={18} color="var(--base08)" />
          </div>
          <span className="flex-1 font-sans text-[1.071rem] font-semibold text-fg">
            Delete workspace
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-[4px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none"
          >
            <Glyph kind="x" size={13} color="var(--base04)" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="font-sans text-[0.929rem] text-muted leading-relaxed">
            You're about to permanently delete{" "}
            <span className="font-semibold text-fg">{workspace.name}</span>.
            This erases the workspace files from disk immediately and{" "}
            <span className="font-semibold text-fg">cannot be undone</span>.
          </p>

          <div className="border border-border rounded-[8px] px-4 py-3 flex items-center gap-3 bg-bg">
            <div className="shrink-0 size-9 rounded-[8px] bg-subtle border border-border flex items-center justify-center">
              <Glyph kind="folder" size={16} color="var(--base04)" />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="font-sans text-[0.929rem] font-semibold text-fg truncate">
                {workspace.name}
              </span>
              <span className="font-sans text-[0.75rem] text-muted truncate">
                {meta}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-sans text-[0.857rem] text-muted">
              Type{" "}
              <button
                type="button"
                onClick={copyName}
                title="Click to copy"
                className="inline-flex items-center gap-1 align-middle font-mono text-[0.786rem] text-error bg-error/10 border border-error/30 rounded-[3px] px-1.5 py-0.5 cursor-pointer hover:bg-error/20 transition-colors outline-none"
              >
                {workspace.name}
                <Glyph
                  kind={copied ? "check" : "copy"}
                  size={11}
                  color="var(--base08)"
                />
              </button>{" "}
              to confirm
            </label>
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={workspace.name}
              className="px-3 py-2 border border-border rounded-[5px] bg-bg text-[0.857rem] text-fg outline-none select-text placeholder:text-muted focus:border-error transition-colors"
            />
          </div>

          {error && (
            <div className="text-[0.786rem] text-error border border-error/50 rounded-[3px] px-2.5 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-error/20 bg-error/[0.06] flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-sans text-[0.786rem] text-error">
            <Glyph kind="warning" size={13} color="var(--base08)" />
            Files erased from disk
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              className="cursor-pointer border-border text-fg bg-transparent hover:bg-subtle hover:text-fg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={disabled}
              className="cursor-pointer bg-error text-bg border-transparent hover:bg-error/85 gap-1.5"
            >
              {deleting ? (
                <Spinner className="size-3.5 shrink-0" />
              ) : (
                <Glyph kind="trash" size={13} color="currentColor" />
              )}
              {deleting ? "Deleting" : "Delete permanently"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
