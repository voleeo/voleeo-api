import type React from "react"
import { useCallback } from "react"
import type {
  AuthConfig,
  HttpRequest,
  RequestParameter,
} from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { AuthTab } from "../AuthTab"
import type { SetAuth } from "../AuthTab/useAuthEditor"
import { BodyTab } from "../BodyTab"
import type { UseBodyEditorResult } from "../BodyTab/useBodyEditor"
import { HeadersTab } from "../HeadersTab"
import type { InheritedHeader } from "../HeadersTab/InheritedHeaders"
import { navigateToInheritedHeader } from "../HeadersTab/navigateInheritedHeader"
import { ParamsTab } from "../ParamsTab"
import type { RequestTab } from "./TabBar"
import type { RequestDraft } from "./useRequestDraft"

interface Props {
  activeTab: RequestTab
  request: HttpRequest | null
  draft: RequestDraft
  inheritedHeaders: InheritedHeader[]
  headersCommitRef: React.RefObject<() => Promise<void>>
  auth: AuthConfig
  body: UseBodyEditorResult
  focusedPathParam: string | null
  pendingQueryParams: Array<{ key: string; value: string }> | null
  onFocusedPathParamConsumed: () => void
  onPendingQueryParamsConsumed: () => void
  onParamCountChange: (enabled: number, total: number) => void
  onVarClick: (varName: string) => void
  onAuthChange: SetAuth
}

export function TabContent({
  activeTab,
  request,
  draft,
  inheritedHeaders,
  headersCommitRef,
  auth,
  body,
  focusedPathParam,
  pendingQueryParams,
  onFocusedPathParamConsumed,
  onPendingQueryParamsConsumed,
  onParamCountChange,
  onVarClick,
  onAuthChange,
}: Props) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const updateRequest = useRequestStore((s) => s.updateRequest)

  const headersCommit = useCallback(
    async (hdrs: RequestParameter[]) => {
      if (!workspaceId || !request) return
      await updateRequest(
        workspaceId,
        request.id,
        request.method,
        request.url,
        request.parameters ?? [],
        hdrs,
      )
    },
    [workspaceId, request, updateRequest],
  )
  const paramsCommit = useCallback(
    async (
      parameters: RequestParameter[],
      opts?: { url?: string },
    ): Promise<void> => {
      if (!workspaceId || !request) return
      await updateRequest(
        workspaceId,
        request.id,
        request.method,
        opts?.url ?? request.url,
        parameters,
        request.headers ?? [],
      )
    },
    [workspaceId, request, updateRequest],
  )
  return (
    <div className="flex-1 overflow-y-auto">
      {activeTab === "params" && request && (
        <ParamsTab
          sourceId={request.id}
          url={request.url}
          liveUrl={draft.urlDraft}
          parameters={request.parameters ?? []}
          workspaceId={workspaceId}
          onCommit={paramsCommit}
          pathParamValues={draft.pathParamValues}
          pathParamEnabled={draft.pathParamEnabled}
          manualPathParamNames={draft.manualPathParamNames}
          onPathParamValuesChange={draft.setPathParamValues}
          onPathParamEnabledChange={draft.setPathParamEnabled}
          onManualPathParamNamesChange={draft.setManualPathParamNames}
          onUrlChanged={draft.setUrlDraft}
          focusedPathParam={focusedPathParam}
          onFocusedPathParamConsumed={onFocusedPathParamConsumed}
          onParamCountChange={onParamCountChange}
          onVarClick={onVarClick}
          pendingQueryParams={pendingQueryParams}
          onPendingQueryParamsConsumed={onPendingQueryParamsConsumed}
        />
      )}
      {activeTab === "params" && !request && <EmptyTabPane />}
      {activeTab === "headers" && request && (
        <HeadersTab
          sourceId={request.id}
          headers={request.headers ?? []}
          onCommit={headersCommit}
          commitRef={headersCommitRef}
          onVarClick={onVarClick}
          inherited={inheritedHeaders}
          onInheritedNavigate={navigateToInheritedHeader}
        />
      )}
      {activeTab === "headers" && !request && <EmptyTabPane />}
      {activeTab === "body" && request && (
        <BodyTab body={body} onVarClick={onVarClick} />
      )}
      {activeTab === "body" && !request && <EmptyTabPane />}
      {activeTab === "auth" && request && (
        <AuthTab
          auth={auth}
          setAuth={onAuthChange}
          onVarClick={onVarClick}
          folderId={request.folderId}
          allowSourceSelect
          protocol="http"
        />
      )}
      {activeTab === "auth" && !request && <EmptyTabPane />}
    </div>
  )
}

function EmptyTabPane() {
  return (
    <div className="flex items-center justify-center h-full text-muted font-sans text-[0.929rem]">
      Select a request
    </div>
  )
}
