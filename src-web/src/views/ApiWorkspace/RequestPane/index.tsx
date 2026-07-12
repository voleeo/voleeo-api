import { useCallback, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { FolderScopeProvider } from "@/components/TemplateInput/folderScope"
import type { CommandImportResult } from "@/lib/commandImport"
import type { AuthConfig } from "@/store/requests"
import { selectActiveRequest, useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import { useUiStore } from "@/store/workspace"
import { EnvironmentsModal } from "@/views/EnvironmentsModal"
import { useAuthEditor } from "../AuthTab/useAuthEditor"
import { useBodyEditor } from "../BodyTab/useBodyEditor"
import { computeInheritedHeaders } from "../HeadersTab/computeInheritedHeaders"
import { SentRequestInspector } from "../SentRequestInspector"
import { RequestActionBar } from "./RequestActionBar"
import { TabBar } from "./TabBar"
import { TabContent } from "./TabContent"
import { useRequestDraft } from "./useRequestDraft"
import { useRequestPaneHandlers } from "./useRequestPaneHandlers"
import { useRequestSend } from "./useRequestSend"

export function RequestPane() {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const activeWorkspace = useUiStore((s) =>
    s.activeWorkspaceId
      ? (s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null)
      : null,
  )
  const activeRequest = useRequestStore(selectActiveRequest)
  const updateRequest = useRequestStore((s) => s.updateRequest)
  const folders = useRequestStore(useShallow((s) => s.folders))

  const inheritedHeaders = useMemo(
    () =>
      computeInheritedHeaders(
        activeRequest?.folderId,
        activeRequest?.headers ?? [],
        folders,
        activeWorkspace,
      ),
    [activeRequest?.folderId, activeRequest?.headers, folders, activeWorkspace],
  )

  const [inspectorOpen, setInspectorOpen] = useState(false)
  const headersCommitRef = useRef<() => Promise<void>>(async () => {})
  const bodyCommitRef = useRef<() => Promise<void>>(async () => {})
  const authCommitRef = useRef<() => Promise<void>>(async () => {})

  const ui = useRequestPaneHandlers(activeRequest)
  const draft = useRequestDraft(activeRequest, ui.onRequestSwitched)

  const saveAuth = useCallback(
    async (next: AuthConfig) => {
      if (!activeWorkspaceId || !activeRequest) return
      await updateRequest(
        activeWorkspaceId,
        activeRequest.id,
        activeRequest.method,
        activeRequest.url,
        activeRequest.parameters ?? [],
        activeRequest.headers ?? [],
        undefined,
        next,
      )
    },
    [activeWorkspaceId, activeRequest, updateRequest],
  )
  const { auth, setAuth } = useAuthEditor({
    sourceId: activeRequest?.id ?? null,
    auth: activeRequest?.auth,
    onSave: saveAuth,
    commitRef: authCommitRef,
  })
  const body = useBodyEditor(activeRequest, bodyCommitRef)

  const send = useRequestSend({
    activeWorkspaceId,
    activeWorkspace,
    activeRequest,
    draft,
    headersCommitRef,
    bodyCommitRef,
    authCommitRef,
  })

  const disabled = !activeRequest || !activeWorkspaceId
  const method = activeRequest?.method ?? "GET"

  const handleImportCommand = useCallback(
    (result: CommandImportResult) => {
      if (!activeWorkspaceId || !activeRequest) return
      draft.setUrlDraft(result.parsed.url)
      void updateRequest(
        activeWorkspaceId,
        activeRequest.id,
        result.parsed.method,
        result.parsed.url,
        result.parsed.parameters,
        result.parsed.headers,
        result.parsed.body,
        result.parsed.auth,
      )
      const label = result.source === "curl" ? "cURL" : "HTTPie"
      useToastStore
        .getState()
        .show(`Imported ${label} command`, undefined, "success")
    },
    [activeWorkspaceId, activeRequest, updateRequest, draft.setUrlDraft],
  )

  return (
    <>
      <FolderScopeProvider folderId={activeRequest?.folderId ?? null}>
        <RequestActionBar
          method={method}
          methodLocked={body.bodyKind === "graphql"}
          urlDraft={draft.urlDraft}
          disabled={disabled}
          isSending={send.isSending}
          onMethodChange={send.commitMethod}
          onUrlChange={draft.setUrlDraft}
          onUrlCommit={send.commitUrl}
          onSend={() => void send.handleSend()}
          onCancel={send.cancelActive}
          onInspect={() => setInspectorOpen(true)}
          onParamClick={ui.handleUrlParamClick}
          onVarClick={ui.handleVarClick}
          onQueryParams={ui.handleUrlQueryParams}
          onImportCommand={handleImportCommand}
        />

        <TabBar
          request={activeRequest}
          activeTab={ui.activeTab}
          paramCounts={ui.paramCounts}
          inheritedHeaders={inheritedHeaders}
          auth={auth}
          bodyKind={body.bodyKind}
          onTabChange={ui.setActiveTab}
          onAuthChange={setAuth}
          onBodyKindChange={body.setBodyKind}
        />

        <TabContent
          activeTab={ui.activeTab}
          request={activeRequest}
          draft={draft}
          inheritedHeaders={inheritedHeaders}
          headersCommitRef={headersCommitRef}
          auth={auth}
          body={body}
          focusedPathParam={ui.focusedPathParam}
          pendingQueryParams={ui.pendingQueryParams}
          onFocusedPathParamConsumed={ui.handleFocusedPathParamConsumed}
          onPendingQueryParamsConsumed={ui.handlePendingQueryParamsConsumed}
          onParamCountChange={ui.handleParamCountChange}
          onVarClick={ui.handleVarClick}
          onAuthChange={setAuth}
        />
      </FolderScopeProvider>

      {inspectorOpen && (
        <SentRequestInspector onClose={() => setInspectorOpen(false)} />
      )}

      {ui.envModalVar && activeWorkspaceId && (
        <EnvironmentsModal
          workspaceId={activeWorkspaceId}
          focusVariable={ui.envModalVar}
          onClose={() => ui.setEnvModalVar(null)}
        />
      )}
    </>
  )
}
