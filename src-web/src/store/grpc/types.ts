import type {
  GrpcResponse,
  GrpcStreamMessage,
  ProtoMethodInfo,
  ProtoServiceInfo,
  TimelineEvent,
} from "../../../../packages/types/bindings"

export type GrpcStatus = "idle" | "connecting" | "streaming" | "done" | "error"

export interface GrpcStore {
  /** Streaming call lifecycle status, keyed by request id. */
  status: Record<string, GrpcStatus>
  /** Streaming transcripts (server + client frames), keyed by request id. */
  transcripts: Record<string, GrpcStreamMessage[]>
  timelines: Record<string, TimelineEvent[]>
  /** Discovered services, keyed by request id. */
  services: Record<string, ProtoServiceInfo[]>
  /** Descriptor (re)build in flight, keyed by request id — drives the spinner. */
  refreshing: Record<string, boolean>
  /** Last unary response, keyed by request id. */
  responses: Record<string, GrpcResponse>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>

  setStatus: (id: string, status: GrpcStatus) => void
  appendMessage: (id: string, message: GrpcStreamMessage) => void
  appendTimeline: (id: string, event: TimelineEvent) => void

  loadServices: (workspaceId: string, id: string) => Promise<ProtoServiceInfo[]>
  refreshServices: (
    workspaceId: string,
    id: string,
  ) => Promise<ProtoServiceInfo[]>
  describeMethod: (
    workspaceId: string,
    id: string,
    service: string,
    method: string,
  ) => Promise<ProtoMethodInfo | null>

  call: (workspaceId: string, id: string, message: string) => Promise<void>
  cancel: (id: string) => Promise<void>

  startStream: (
    workspaceId: string,
    id: string,
    message: string,
  ) => Promise<void>
  sendStreamMessage: (
    workspaceId: string,
    id: string,
    message: string,
  ) => Promise<void>
  closeSend: (id: string) => Promise<void>
  cancelStream: (workspaceId: string, id: string) => Promise<void>
  hydrate: (workspaceId: string, id: string) => Promise<void>
  clearTranscript: (workspaceId: string, id: string) => Promise<void>
  /** Drop the in-memory unary response/error for a request (after clearing history). */
  clearResponse: (id: string) => void
}
