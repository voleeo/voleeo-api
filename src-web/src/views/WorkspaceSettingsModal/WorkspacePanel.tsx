import { useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { MonoLabel } from "@/components/Primitives"
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { errorMessage } from "@/lib/error"
import { useRequestStore } from "@/store/requests"
import type { Workspace } from "@/store/workspace"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"
import { PanelHeading } from "./PanelHeading"

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 flex flex-col gap-1">
      <MonoLabel size={8.5} color="var(--base04)">
        {label}
      </MonoLabel>
      <span className="font-sans text-[0.929rem] text-fg">{value}</span>
    </div>
  )
}

function DeleteConfirmDialog({
  workspaceName,
  workspaceId,
  onCancel,
}: {
  workspaceName: string
  workspaceId: string
  onCancel: () => void
}) {
  const loadWorkspaces = useUiStore((s) => s.loadWorkspaces)
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)

  useState(() => {
    commands.getAppInfo().then((res) => {
      if (res.status === "ok") {
        const sep = res.data.data_dir.includes("\\") ? "\\" : "/"
        setWorkspacePath(
          `${res.data.data_dir}${sep}workspaces${sep}${workspaceId}`,
        )
      }
    })
  })

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await commands.deleteWorkspace(workspaceId)
      if (res.status === "ok") {
        await loadWorkspaces()
        setActiveTool("welcome")
      } else {
        setError(errorMessage(res.error))
        setDeleting(false)
      }
    } catch {
      setError("Unexpected error. Please try again.")
      setDeleting(false)
    }
  }

  return (
    <ConfirmationDialog
      title="Delete Workspace"
      icon="warning"
      description={
        <>
          Are you sure you want to permanently delete{" "}
          <span className="font-semibold">"{workspaceName}"</span>?
        </>
      }
      infoBox={
        <>
          <span className="font-sans text-[0.929rem] font-semibold text-fg">
            {workspaceName}
          </span>
          {workspacePath && (
            <span className="font-mono text-[0.75rem] text-muted break-all">
              {workspacePath}
            </span>
          )}
        </>
      }
      warningText="The workspace files will be permanently deleted from disk."
      confirmByTyping={workspaceName}
      confirmByTypingLabel={
        <>
          Type{" "}
          <span className="font-mono text-[0.786rem] text-error bg-error/10 border border-error/30 rounded-[3px] px-1.5 py-0.5">
            {workspaceName}
          </span>{" "}
          to confirm
        </>
      }
      onCancel={onCancel}
      onConfirm={handleDelete}
      confirmLabel="Delete"
      confirmVariant="destructive"
      isLoading={deleting}
      loadingLabel="Deleting"
      error={error}
    />
  )
}

export function WorkspacePanel({
  workspace,
  onNavigateToStorage,
}: {
  workspace: Workspace
  onNavigateToStorage: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [keyMissing, setKeyMissing] = useState(false)
  const requestCount = useRequestStore((s) => s.requests.length)
  const connectionCount = useRequestStore((s) => s.connections.length)
  const totalRequests = requestCount + connectionCount

  useEffect(() => {
    if (!workspace.encrypted) return
    commands.workspaceHasKey(workspace.id).then((res) => {
      if (res.status === "ok") setKeyMissing(!res.data)
    })
  }, [workspace.id, workspace.encrypted])

  const created = new Date(workspace.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return (
    <>
      <div className="flex flex-col gap-5">
        <PanelHeading
          title="Workspace"
          description="Overview and portability for this workspace. Rename from the title bar."
        />

        <div className="border border-border rounded-[5px] grid grid-cols-3 divide-x divide-border overflow-hidden">
          <StatCell label="Created" value={created} />
          <StatCell label="Requests" value={String(totalRequests)} />
          <StatCell
            label="Encrypted"
            value={workspace.encrypted ? "Yes" : "No"}
          />
        </div>

        {/* Missing encryption key warning */}
        {keyMissing && (
          <div className="border border-(--accent-warning)/50 bg-(--accent-warning)/5 rounded-[5px] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <Glyph kind="warning" size={14} color="var(--base0A)" />
              <p className="font-sans text-[0.857rem] font-semibold text-warn">
                Encryption key not found
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.75rem] text-muted mt-0.5 leading-relaxed">
                This workspace is encrypted but no key was found on this
                machine.
                <br />
                You won't be able to read encrypted data until you provide the
                encryption key.
              </p>
              <button
                type="button"
                onClick={onNavigateToStorage}
                className="mt-1.5 text-[0.75rem] text-accent cursor-pointer bg-transparent border-0 outline-none p-0 hover:underline"
              >
                Go to Storage → Import encryption key
              </button>
            </div>
          </div>
        )}

        <div className="border border-error/30 rounded-[5px] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <Glyph kind="warning-octagon" size={14} color="var(--base08)" />
            <span className="font-sans text-[0.929rem] font-semibold text-error">
              Danger zone
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-sans text-[0.929rem] font-medium text-fg">
                Delete this workspace
              </div>
              <div className="text-[0.75rem] text-muted mt-0.5 leading-relaxed">
                Removes all data for this workspace.
                <br />
                This can't be undone.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="shrink-0 px-3 py-1.5 rounded-[4px] font-sans text-[0.857rem] font-medium text-error border border-error/50 bg-transparent cursor-pointer hover:bg-error/10 outline-none transition-colors"
            >
              Delete workspace
            </button>
          </div>
        </div>
      </div>

      {deleteOpen && (
        <DeleteConfirmDialog
          workspaceName={workspace.name}
          workspaceId={workspace.id}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </>
  )
}
