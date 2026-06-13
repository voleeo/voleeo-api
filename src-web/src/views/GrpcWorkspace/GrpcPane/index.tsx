import { type ReactNode, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { FolderScopeProvider } from "@/components/TemplateInput/folderScope"
import { usePaneTabsStore } from "@/store/paneTabs"
import {
  type GrpcRequest,
  selectActiveGrpc,
  useRequestStore,
} from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { AuthTab } from "@/views/ApiWorkspace/AuthTab"
import { useAuthEditor } from "@/views/ApiWorkspace/AuthTab/useAuthEditor"
import { HeadersTab } from "@/views/ApiWorkspace/HeadersTab"
import { computeInheritedHeaders } from "@/views/ApiWorkspace/HeadersTab/computeInheritedHeaders"
import { navigateToInheritedHeader } from "@/views/ApiWorkspace/HeadersTab/navigateInheritedHeader"
import {
  configuredLabel,
  countLabel,
} from "@/views/ApiWorkspace/RequestPane/TabBar"
import { EnvironmentsModal } from "@/views/EnvironmentsModal"
import { useWsVarClickHandler } from "@/views/WsWorkspace/WsPane/useWsVarClickHandler"
import type {
  AuthConfig,
  ProtoSource,
} from "../../../../../packages/types/bindings"
import { ProtoMessageForm } from "../ProtoMessageForm"
import { GrpcHeader } from "./GrpcHeader"
import { type GrpcTab, GrpcTabBar, type MsgMode } from "./GrpcTabBar"
import { MessageEditor } from "./MessageEditor"
import { useGrpcDraft } from "./useGrpcDraft"
import { useGrpcSend } from "./useGrpcSend"

export function GrpcPane() {
  const request = useRequestStore(selectActiveGrpc)
  if (!request) return null
  return <GrpcPaneInner key={request.id} request={request} />
}

function GrpcPaneInner({ request }: { request: GrpcRequest }) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId) ?? ""
  // Remember the selected tab + message mode per request (component is keyed by
  // request id, so it remounts on switch).
  const tabs = usePaneTabsStore.getState()
  const [tab, setTabState] = useState<GrpcTab>(
    (tabs.grpcTabs[request.id] as GrpcTab | undefined) ?? "message",
  )
  const setTab = (next: GrpcTab) => {
    setTabState(next)
    usePaneTabsStore.getState().setGrpcTab(request.id, next)
  }
  const [msgMode, setMsgModeState] = useState<MsgMode>(
    (tabs.grpcModes[request.id] as MsgMode | undefined) ?? "form",
  )
  const setMsgMode = (next: MsgMode) => {
    setMsgModeState(next)
    usePaneTabsStore.getState().setGrpcMode(request.id, next)
  }
  const [envModalVar, setEnvModalVar] = useState<string | null>(null)
  const handleVarClick = useWsVarClickHandler(
    request.folderId ?? null,
    setEnvModalVar,
  )
  const authCommitRef = useRef<() => Promise<void>>(async () => {})
  const metadataCommitRef = useRef<() => Promise<void>>(async () => {})
  const authRef = useRef<AuthConfig>(request.auth ?? { kind: "none" })

  const draft = useGrpcDraft(workspaceId, request, authRef)
  const { auth, setAuth } = useAuthEditor({
    sourceId: request.id,
    auth: request.auth,
    onSave: async (next) => draft.commitWith({ auth: next }),
    commitRef: authCommitRef,
  })
  authRef.current = auth

  const { status, kind, canSend, handlers, onSendShortcut } = useGrpcSend(
    workspaceId,
    request.id,
    draft,
  )

  const onProtoSourceChange = (next: ProtoSource) => {
    // The schema is being rebuilt from a new source, so the current selection
    // may no longer exist — drop it rather than leave a stale method showing.
    draft.setProtoSource(next)
    draft.clearMethod()
    draft.commitConn({ protoSource: next, service: null, method: null })
  }

  const folders = useRequestStore(useShallow((s) => s.folders))
  const workspaces = useUiStore((s) => s.workspaces)
  const inheritedMetadata = useMemo(
    () =>
      computeInheritedHeaders(
        request.folderId,
        draft.metadata,
        folders,
        workspaces.find((w) => w.id === workspaceId),
      ),
    [request.folderId, draft.metadata, folders, workspaces, workspaceId],
  )

  const metaNamed = draft.metadata.filter((m) => m.name.trim())
  const tabLabel: Record<GrpcTab, ReactNode> = {
    message: "MESSAGE",
    metadata: countLabel(
      "METADATA",
      metaNamed.filter((m) => m.enabled).length,
      metaNamed.length,
    ),
    auth: configuredLabel("AUTH", auth.kind !== "none"),
  }

  return (
    <FolderScopeProvider folderId={request.folderId ?? null}>
      <div className="h-full flex flex-col overflow-hidden">
        <GrpcHeader
          requestId={request.id}
          target={draft.target}
          onTargetChange={draft.setTarget}
          onTargetCommit={() => draft.commitConn({})}
          onVarClick={handleVarClick}
          tls={draft.tls}
          onTlsChange={(next) => {
            draft.setTls(next)
            draft.commitConn({ tls: next })
          }}
          refreshing={draft.refreshing}
          onRefresh={draft.refresh}
          service={draft.service}
          method={draft.method}
          onSelectMethod={(s, m) => {
            draft.selectMethod(s, m)
            draft.commitWith({ service: s, method: m })
          }}
          protoSource={draft.protoSource}
          onProtoSourceChange={onProtoSourceChange}
          kind={kind}
          status={status}
          canSend={canSend}
          {...handlers}
        />

        <GrpcTabBar
          tab={tab}
          onTab={setTab}
          labels={tabLabel}
          hasSchema={!!draft.schema}
          msgMode={msgMode}
          onMsgMode={setMsgMode}
          auth={auth}
          onAuthChange={setAuth}
        />

        <div
          className="flex-1 min-h-0 overflow-auto"
          // The window-level shortcut ignores text inputs, so handle ⌘/Ctrl-Enter
          // from the message form fields here (only when focus is in an input,
          // to avoid double-firing with the global hook).
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return
            const t = e.target as HTMLElement
            if (
              t.tagName === "INPUT" ||
              t.tagName === "TEXTAREA" ||
              t.isContentEditable
            ) {
              e.preventDefault()
              onSendShortcut()
            }
          }}
        >
          {tab === "message" &&
            (!draft.schema ? (
              <p className="px-3.5 py-3 font-mono text-[0.857rem] text-muted">
                Select a service and method to build the request message.
              </p>
            ) : msgMode === "editor" ? (
              <MessageEditor
                value={draft.message}
                onChange={draft.setMessage}
                onVarClick={handleVarClick}
                workspaceId={workspaceId}
              />
            ) : (
              <ProtoMessageForm
                schema={draft.schema.input}
                value={draft.message}
                onChange={draft.setMessage}
                describeMessage={draft.describeMessage}
                onVarClick={handleVarClick}
              />
            ))}
          {tab === "metadata" && (
            <HeadersTab
              sourceId={request.id}
              headers={draft.metadata}
              onCommit={async (next) => {
                draft.setMetadata(next)
                draft.commitWith({ metadata: next })
              }}
              commitRef={metadataCommitRef}
              onVarClick={handleVarClick}
              inherited={inheritedMetadata}
              onInheritedNavigate={navigateToInheritedHeader}
            />
          )}
          {tab === "auth" && (
            <AuthTab
              auth={auth}
              setAuth={setAuth}
              onVarClick={handleVarClick}
              folderId={request.folderId ?? null}
              protocol="grpc"
            />
          )}
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
