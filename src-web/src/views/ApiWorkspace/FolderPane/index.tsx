import { useMemo, useRef } from "react"
import { FolderScopeProvider } from "@/components/TemplateInput/folderScope"
import { selectActiveFolder, useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { EnvironmentsModal } from "@/views/EnvironmentsModal"
import { VariablesEditor } from "@/views/EnvironmentsModal/VariablesEditor"
import { AuthTab } from "../AuthTab"
import { useAuthEditor } from "../AuthTab/useAuthEditor"
import { HeadersTab } from "../HeadersTab"
import { computeInheritedHeaders } from "../HeadersTab/computeInheritedHeaders"
import { navigateToInheritedHeader } from "../HeadersTab/navigateInheritedHeader"
import { FolderHeader } from "./FolderHeader"
import { FolderTabBar } from "./FolderTabBar"
import { useFolderPaneHandlers } from "./useFolderPaneHandlers"

export function FolderPane() {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const workspace = useUiStore((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  )
  const folder = useRequestStore(selectActiveFolder)
  const folders = useRequestStore((s) => s.folders)

  const {
    activeTab,
    setActiveTab,
    varFocusKey,
    headerFocusKey,
    envModalVar,
    setEnvModalVar,
    saveHeaders,
    saveAuth,
    saveVariables,
    renameVariable,
    handleVarClick,
  } = useFolderPaneHandlers(folder, activeWorkspaceId)

  const headersCommitRef = useRef<() => Promise<void>>(async () => {})
  const authCommitRef = useRef<() => Promise<void>>(async () => {})

  const { auth, setAuth } = useAuthEditor({
    sourceId: folder?.id ?? null,
    auth: folder?.auth,
    onSave: saveAuth,
    commitRef: authCommitRef,
  })

  // Headers inherited from ancestor folders + workspace — read-only section and
  // key-autocomplete override suggestions for this folder's Headers tab.
  const inheritedHeaders = useMemo(
    () =>
      folder
        ? computeInheritedHeaders(
            folder.folderId,
            folder.headers ?? [],
            folders,
            workspace,
          )
        : [],
    [folder, folders, workspace],
  )

  if (!folder) return null

  return (
    <>
      <div className="shrink-0 bg-accent/[0.035]">
        <FolderHeader folder={folder} activeWorkspaceId={activeWorkspaceId} />

        <FolderTabBar
          folder={folder}
          activeTab={activeTab}
          auth={auth}
          onTabChange={setActiveTab}
          onAuthChange={setAuth}
        />
      </div>

      <FolderScopeProvider folderId={folder.id}>
        <div className="flex-1 overflow-y-auto">
          {activeTab === "headers" && (
            <HeadersTab
              sourceId={folder.id}
              headers={folder.headers ?? []}
              onCommit={saveHeaders}
              commitRef={headersCommitRef}
              focusKey={headerFocusKey}
              inherited={inheritedHeaders}
              onInheritedNavigate={navigateToInheritedHeader}
              onVarClick={handleVarClick}
            />
          )}
          {activeTab === "auth" && (
            <AuthTab
              auth={auth}
              setAuth={setAuth}
              onVarClick={handleVarClick}
              folderId={folder.folderId}
            />
          )}
          {activeTab === "variables" && (
            <div className="px-3.5 py-3">
              <VariablesEditor
                source={folder.variables ?? []}
                updatedAt={folder.updatedAt}
                onSave={saveVariables}
                onRename={renameVariable}
                focusKey={varFocusKey}
              />
            </div>
          )}
        </div>
      </FolderScopeProvider>

      {envModalVar !== null && activeWorkspaceId && (
        <EnvironmentsModal
          workspaceId={activeWorkspaceId}
          focusVariable={envModalVar}
          onClose={() => setEnvModalVar(null)}
        />
      )}
    </>
  )
}
