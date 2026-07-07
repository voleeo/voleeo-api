import { create } from "zustand"
import { capPush } from "@/lib/boundedArray"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { resolveInheritedAuth } from "@/views/ApiWorkspace/sendResolution/inheritance"
import type {
  AuthConfig,
  StoredWsSession,
  StoredWsSessionSummary,
  TimelineEvent,
  WsMessage,
  WsMessageKind,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"

export type WsConnStatus =
  | "closed"
  | "connecting"
  | "open"
  | "closing"
  | "error"

interface WebsocketStore {
  status: Record<string, WsConnStatus>
  transcripts: Record<string, WsMessage[]>
  timelines: Record<string, TimelineEvent[]>

  setStatus: (connectionId: string, status: WsConnStatus) => void
  appendMessage: (connectionId: string, message: WsMessage) => void
  appendTimeline: (connectionId: string, event: TimelineEvent) => void

  /** Load the persisted transcript + current connection state for a connection. */
  hydrate: (workspaceId: string, connectionId: string) => Promise<void>
  connect: (workspaceId: string, connectionId: string) => Promise<void>
  disconnect: (workspaceId: string, connectionId: string) => Promise<void>
  sendMessage: (
    workspaceId: string,
    connectionId: string,
    kind: WsMessageKind,
    data: string,
  ) => Promise<void>
  clearTranscript: (workspaceId: string, connectionId: string) => Promise<void>
  /** List past sessions (newest first) for the connection's history picker. */
  listSessions: (
    workspaceId: string,
    connectionId: string,
  ) => Promise<StoredWsSessionSummary[]>
  /** Fetch a past session's full transcript. */
  getSession: (
    workspaceId: string,
    connectionId: string,
    sessionId: string,
  ) => Promise<StoredWsSession | null>
}

function activeEnvId(): string | null {
  return useEnvironmentStore.getState().activeEnvId
}

/** Returns a resolved auth to pass as `authOverride` to `ws_connect`, or null
 *  when no override is needed (the auth isn't Inherit, or the connection /
 *  workspace can't be found — backend falls back to stored auth). */
function resolveAuthForConnect(
  workspaceId: string,
  connectionId: string,
): AuthConfig | null {
  const connections = useRequestStore.getState().connections
  const connection = connections.find((c) => c.id === connectionId)
  if (!connection || connection.auth?.kind !== "inherit") return null
  const workspace = useUiStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return null
  const folders = useRequestStore.getState().folders
  return resolveInheritedAuth(connection, folders, workspace)
}

export const useWebsocketStore = create<WebsocketStore>((set, get) => ({
  status: {},
  transcripts: {},
  timelines: {},

  setStatus: (connectionId, status) =>
    set((s) =>
      s.status[connectionId] === status
        ? s
        : { status: { ...s.status, [connectionId]: status } },
    ),

  appendMessage: (connectionId, message) =>
    set((s) => {
      const current = s.transcripts[connectionId] ?? []
      // Dedup by id — the backend emits one event per message; guard re-delivery.
      if (current.some((m) => m.id === message.id)) return s
      return {
        transcripts: {
          ...s.transcripts,
          [connectionId]: capPush(current, message),
        },
      }
    }),

  appendTimeline: (connectionId, event) =>
    set((s) => {
      const current = s.timelines[connectionId] ?? []
      return {
        timelines: {
          ...s.timelines,
          [connectionId]: capPush(current, event),
        },
      }
    }),

  hydrate: async (workspaceId, connectionId) => {
    const [transcriptRes, connectedRes] = await Promise.all([
      commands.wsGetTranscript(workspaceId, connectionId),
      commands.wsIsConnected(connectionId),
    ])
    const connected = connectedRes.status === "ok" && connectedRes.data
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [connectionId]:
          transcriptRes.status === "ok"
            ? (transcriptRes.data.messages ?? [])
            : [],
      },
      timelines: {
        ...s.timelines,
        [connectionId]:
          transcriptRes.status === "ok"
            ? (transcriptRes.data.events ?? [])
            : [],
      },
      status: { ...s.status, [connectionId]: connected ? "open" : "closed" },
    }))
  },

  connect: async (workspaceId, connectionId) => {
    get().setStatus(connectionId, "connecting")
    // Each connect starts a new history session — reset live view.
    set((s) => ({
      transcripts: { ...s.transcripts, [connectionId]: [] },
      timelines: { ...s.timelines, [connectionId]: [] },
    }))
    const authOverride = resolveAuthForConnect(workspaceId, connectionId)
    const res = await commands.wsConnect(
      workspaceId,
      connectionId,
      activeEnvId(),
      authOverride,
    )
    // Status transitions otherwise arrive via `ws:status` events; on a hard
    // failure no event fires, so reflect the error here.
    if (res.status !== "ok") get().setStatus(connectionId, "error")
  },

  disconnect: async (workspaceId, connectionId) => {
    get().setStatus(connectionId, "closing")
    await commands.wsDisconnect(workspaceId, connectionId)
  },

  sendMessage: async (workspaceId, connectionId, kind, data) => {
    // No optimistic append — the backend emits a `ws:message` event for the
    // outbound row too, so the event handler is the single source of truth.
    await commands.wsSendMessage(
      workspaceId,
      connectionId,
      kind,
      data,
      activeEnvId(),
    )
  },

  clearTranscript: async (workspaceId, connectionId) => {
    await commands.wsClearTranscript(workspaceId, connectionId)
    set((s) => ({
      transcripts: { ...s.transcripts, [connectionId]: [] },
      timelines: { ...s.timelines, [connectionId]: [] },
    }))
  },

  listSessions: async (workspaceId, connectionId) => {
    const res = await commands.wsListSessions(workspaceId, connectionId)
    return res.status === "ok" ? res.data : []
  },

  getSession: async (workspaceId, connectionId, sessionId) => {
    const res = await commands.wsGetSession(
      workspaceId,
      connectionId,
      sessionId,
    )
    return res.status === "ok" ? res.data : null
  },
}))
