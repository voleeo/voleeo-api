import type { RefObject } from "react"
import type {
  AuthConfig,
  RequestParameter,
  WsConnection,
} from "@/store/requests"
import { AuthTab } from "@/views/ApiWorkspace/AuthTab"
import type { SetAuth } from "@/views/ApiWorkspace/AuthTab/useAuthEditor"
import { HeadersTab } from "@/views/ApiWorkspace/HeadersTab"
import type { InheritedHeader } from "@/views/ApiWorkspace/HeadersTab/InheritedHeaders"
import { navigateToInheritedHeader } from "@/views/ApiWorkspace/HeadersTab/navigateInheritedHeader"
import { ParamsTab } from "@/views/ApiWorkspace/ParamsTab"
import type { ParamsCommit } from "@/views/ApiWorkspace/ParamsTab/paramsCommit"
import { Composer } from "./Composer"
import type { WsMessageUiKind } from "./WsKindSelect"
import type { WsTab } from "./wsTabLabel"

interface Props {
  tab: WsTab
  connection: WsConnection
  workspaceId: string
  status: string
  uiKind: WsMessageUiKind
  messageDraft: string
  setMessageDraft: React.Dispatch<React.SetStateAction<string>>
  urlDraft: string
  setUrlDraft: (v: string) => void
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  manualPathParamNames: string[]
  onPathParamValuesChange: (values: Record<string, string>) => void
  onPathParamEnabledChange: (enabled: Record<string, boolean>) => void
  onManualPathParamNamesChange: (names: string[]) => void
  onParamCountChange: (enabled: number, total: number) => void
  pendingQueryParams: Array<{ key: string; value: string }> | null
  onPendingQueryParamsConsumed: () => void
  commitParams: ParamsCommit
  commitHeaders: (h: RequestParameter[]) => Promise<void>
  headersCommitRef: RefObject<() => Promise<void>>
  auth: AuthConfig
  setAuth: SetAuth
  inheritedHeaders: InheritedHeader[]
  onVarClick: (varName: string) => void
}

export function WsTabBody({
  tab,
  connection,
  workspaceId,
  status,
  uiKind,
  messageDraft,
  setMessageDraft,
  urlDraft,
  setUrlDraft,
  pathParamValues,
  pathParamEnabled,
  manualPathParamNames,
  onPathParamValuesChange,
  onPathParamEnabledChange,
  onManualPathParamNamesChange,
  onParamCountChange,
  pendingQueryParams,
  onPendingQueryParamsConsumed,
  commitParams,
  commitHeaders,
  headersCommitRef,
  auth,
  setAuth,
  inheritedHeaders,
  onVarClick,
}: Props) {
  if (tab === "params") {
    return (
      <ParamsTab
        sourceId={connection.id}
        url={connection.url}
        liveUrl={urlDraft}
        parameters={connection.parameters ?? []}
        workspaceId={workspaceId}
        onCommit={commitParams}
        pathParamValues={pathParamValues}
        pathParamEnabled={pathParamEnabled}
        manualPathParamNames={manualPathParamNames}
        onPathParamValuesChange={onPathParamValuesChange}
        onPathParamEnabledChange={onPathParamEnabledChange}
        onManualPathParamNamesChange={onManualPathParamNamesChange}
        onUrlChanged={setUrlDraft}
        onParamCountChange={onParamCountChange}
        onVarClick={onVarClick}
        pendingQueryParams={pendingQueryParams}
        onPendingQueryParamsConsumed={onPendingQueryParamsConsumed}
      />
    )
  }
  if (tab === "headers") {
    return (
      <HeadersTab
        sourceId={connection.id}
        headers={connection.headers ?? []}
        onCommit={commitHeaders}
        commitRef={headersCommitRef}
        onVarClick={onVarClick}
        inherited={inheritedHeaders}
        onInheritedNavigate={navigateToInheritedHeader}
      />
    )
  }
  if (tab === "message") {
    return (
      <Composer
        workspaceId={workspaceId}
        connection={connection}
        canSend={status === "open"}
        uiKind={uiKind}
        draft={messageDraft}
        setDraft={setMessageDraft}
        onVarClick={onVarClick}
      />
    )
  }
  return (
    <AuthTab
      auth={auth}
      setAuth={setAuth}
      onVarClick={onVarClick}
      folderId={connection.folderId}
      allowSourceSelect
      protocol="ws"
    />
  )
}
