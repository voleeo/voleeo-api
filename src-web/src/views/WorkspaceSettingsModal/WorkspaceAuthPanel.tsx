import { useCallback, useRef } from "react"
import { type AuthConfig, useUiStore, type Workspace } from "@/store/workspace"
import { AuthFields } from "@/views/ApiWorkspace/AuthTab/AuthFields"
import { AuthTypeSelect } from "@/views/ApiWorkspace/AuthTab/AuthTypeSelect"
import { useAuthEditor } from "@/views/ApiWorkspace/AuthTab/useAuthEditor"
import { PanelHeading } from "./PanelHeading"

export function WorkspaceAuthPanel({ workspace }: { workspace: Workspace }) {
  const updateWorkspaceAuth = useUiStore((s) => s.updateWorkspaceAuth)
  const commitRef = useRef<() => Promise<void>>(async () => {})

  const onSave = useCallback(
    async (next: AuthConfig) => {
      await updateWorkspaceAuth(workspace.id, next)
    },
    [workspace.id, updateWorkspaceAuth],
  )

  const { auth, setAuth } = useAuthEditor({
    sourceId: workspace.id,
    auth: workspace.auth,
    onSave,
    commitRef,
  })

  return (
    <div className="flex flex-col gap-3">
      <PanelHeading
        title="Auth"
        description={
          <>
            Applies to requests set to <span className="text-fg">Inherit</span>.
            Folder auth overrides it.
          </>
        }
      />
      <div className="-ml-2.5">
        <AuthTypeSelect auth={auth} onChange={setAuth} />
      </div>
      {auth.kind !== "none" && (
        <div className="flex flex-col gap-3">
          <AuthFields auth={auth} setAuth={setAuth} onVarClick={() => {}} />
        </div>
      )}
    </div>
  )
}
