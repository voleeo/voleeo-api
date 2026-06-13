import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { TabItem } from "@/components/Primitives"
import { FolderScopeProvider } from "@/components/TemplateInput/folderScope"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { usePaneTabsStore } from "@/store/paneTabs"
import { selectActiveConnection, useRequestStore } from "@/store/requests"
import { useWebsocketStore } from "@/store/websocket"
import { useUiStore } from "@/store/workspace"
import { AuthTypeSelect } from "@/views/ApiWorkspace/AuthTab/AuthTypeSelect"
import { useAuthEditor } from "@/views/ApiWorkspace/AuthTab/useAuthEditor"
import { computeInheritedHeaders } from "@/views/ApiWorkspace/HeadersTab/computeInheritedHeaders"
import { EnvironmentsModal } from "@/views/EnvironmentsModal"
import { useWsCommits } from "./useWsCommits"
import { useWsPathParamDraft } from "./useWsPathParamDraft"
import { useWsVarClickHandler } from "./useWsVarClickHandler"
import { WsKindSelect, type WsMessageUiKind } from "./WsKindSelect"
import { WsTabBody } from "./WsTabBody"
import { WsUrlBar } from "./WsUrlBar"
import { type WsTab, wsTabLabel } from "./wsTabLabel"

const TABS: WsTab[] = ["message", "params", "headers", "auth"]

export function WsPane() {
  const connection = useRequestStore(selectActiveConnection)
  const workspaces = useUiStore((s) => s.workspaces)
  const folders = useRequestStore(useShallow((s) => s.folders))
  const workspaceId = useUiStore((s) => s.activeWorkspaceId) ?? ""
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId),
    [workspaces, workspaceId],
  )
  const status =
    useWebsocketStore((s) =>
      connection ? s.status[connection.id] : undefined,
    ) ?? "closed"
  const { connect, disconnect, hydrate } = useWebsocketStore(
    useShallow((s) => ({
      connect: s.connect,
      disconnect: s.disconnect,
      hydrate: s.hydrate,
    })),
  )
  const sendMessage = useWebsocketStore((s) => s.sendMessage)

  // Tab memory keyed per connection. Component is remounted on id switch.
  const initialTab =
    (connection
      ? (usePaneTabsStore.getState().wsTabs[connection.id] as WsTab | undefined)
      : undefined) ?? "message"
  const [tab, setTabState] = useState<WsTab>(initialTab)
  const setTab = (next: WsTab) => {
    setTabState(next)
    if (connection) usePaneTabsStore.getState().setWsTab(connection.id, next)
  }
  const [uiKind, setUiKind] = useState<WsMessageUiKind>("json")
  const [messageDraft, setMessageDraft] = useState("")
  const [urlOverride, setUrlOverride] = useState<string | null>(null)
  const urlDraft = urlOverride ?? connection?.url ?? ""
  const setUrlDraft = setUrlOverride
  const [envModalVar, setEnvModalVar] = useState<string | null>(null)
  const onToggleRef = useRef<() => void>(() => {})

  const {
    pathParamValues,
    setPathParamValues,
    pathParamEnabled,
    setPathParamEnabled,
    manualPathParamNames,
    setManualPathParamNames,
    paramCounts,
    setParamCounts,
  } = useWsPathParamDraft(connection)

  const [pendingQueryParams, setPendingQueryParams] = useState<Array<{
    key: string
    value: string
  }> | null>(null)

  const live = status === "open" || status === "connecting"

  const handleUrlSend = useCallback(() => {
    if (!live) onToggleRef.current()
  }, [live])

  const handleVarClick = useWsVarClickHandler(
    connection?.folderId ?? null,
    setEnvModalVar,
  )

  const sendShortcutRef = useRef<() => void>(() => {})
  const fireSend = useCallback(() => sendShortcutRef.current(), [])
  useKeydown(SHORTCUTS.SEND_REQUEST, fireSend)
  useKeydown(SHORTCUTS.SEND_REQUEST_CTRL, fireSend)

  const connectionId = connection?.id
  useEffect(() => {
    if (workspaceId && connectionId) hydrate(workspaceId, connectionId)
  }, [workspaceId, connectionId, hydrate])

  const storedUrl = connection?.url
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on external URL change
  useEffect(() => setUrlOverride(null), [storedUrl])

  const inheritedHeaders = useMemo(
    () =>
      computeInheritedHeaders(
        connection?.folderId ?? null,
        connection?.headers ?? [],
        folders,
        workspace,
      ),
    [connection?.folderId, connection?.headers, folders, workspace],
  )

  const headersCommitRef = useRef<() => Promise<void>>(async () => {})
  const authCommitRef = useRef<() => Promise<void>>(async () => {})
  const { commitUrl, commitHeaders, commitAuth, commitParams } = useWsCommits(
    workspaceId,
    connection,
  )

  const { auth, setAuth } = useAuthEditor({
    sourceId: connection?.id ?? null,
    auth: connection?.auth,
    onSave: commitAuth,
    commitRef: authCommitRef,
  })

  if (!connection) return null

  function handleSendMessage() {
    if (!connection || status !== "open" || !messageDraft.trim()) return
    void sendMessage(workspaceId, connection.id, "text", messageDraft)
  }

  async function onToggle() {
    if (!connection) return
    if (live) {
      void disconnect(workspaceId, connection.id)
      return
    }

    commitUrl(urlDraft)
    await Promise.all([headersCommitRef.current(), authCommitRef.current()])
    void connect(workspaceId, connection.id)
  }
  onToggleRef.current = () => {
    void onToggle()
  }
  sendShortcutRef.current = () => {
    if (status === "open") handleSendMessage()
    else handleUrlSend()
  }

  return (
    <FolderScopeProvider folderId={connection.folderId ?? null}>
      <div className="h-full flex flex-col overflow-hidden">
        <WsUrlBar
          urlDraft={urlDraft}
          setUrlDraft={setUrlDraft}
          onCommitUrl={() => commitUrl(urlDraft)}
          onUrlSend={handleUrlSend}
          onVarClick={handleVarClick}
          onToggle={() => void onToggle()}
          onSendMessage={handleSendMessage}
          onQueryParams={(params) => {
            setPendingQueryParams(params)
            setTab("params")
          }}
          live={live}
          open={status === "open"}
          sendDisabled={!messageDraft.trim()}
        />

        <div className="px-3.5 border-b border-border flex items-center shrink-0">
          {TABS.map((t) => (
            <TabItem
              key={t}
              label={wsTabLabel(t, {
                paramCounts,
                headers: connection.headers,
                auth,
              })}
              active={tab === t}
              onClick={() => setTab(t)}
            />
          ))}
          {tab === "message" && (
            <div className="ml-auto">
              <WsKindSelect kind={uiKind} onChange={setUiKind} />
            </div>
          )}
          {tab === "auth" && (
            <div className="ml-auto">
              <AuthTypeSelect
                auth={auth}
                onChange={setAuth}
                allowInherit
                protocol="ws"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <WsTabBody
            tab={tab}
            connection={connection}
            workspaceId={workspaceId}
            status={status}
            uiKind={uiKind}
            messageDraft={messageDraft}
            setMessageDraft={setMessageDraft}
            urlDraft={urlDraft}
            setUrlDraft={setUrlDraft}
            pathParamValues={pathParamValues}
            pathParamEnabled={pathParamEnabled}
            manualPathParamNames={manualPathParamNames}
            onPathParamValuesChange={setPathParamValues}
            onPathParamEnabledChange={setPathParamEnabled}
            onManualPathParamNamesChange={setManualPathParamNames}
            onParamCountChange={(enabled, total) =>
              setParamCounts((p) =>
                p?.enabled === enabled && p?.total === total
                  ? p
                  : { enabled, total },
              )
            }
            pendingQueryParams={pendingQueryParams}
            onPendingQueryParamsConsumed={() => setPendingQueryParams(null)}
            commitParams={commitParams}
            commitHeaders={commitHeaders}
            headersCommitRef={headersCommitRef}
            auth={auth}
            setAuth={setAuth}
            inheritedHeaders={inheritedHeaders}
            onVarClick={handleVarClick}
          />
        </div>
        {envModalVar && workspaceId && (
          <EnvironmentsModal
            workspaceId={workspaceId}
            focusVariable={{ key: envModalVar }}
            onClose={() => setEnvModalVar(null)}
          />
        )}
      </div>
    </FolderScopeProvider>
  )
}
