import type { StateCreator } from "zustand"
import { commands } from "../../../../packages/types/bindings"
import { activeEnvId, authOverrideFor } from "./shared"
import type { GrpcStore } from "./types"

type StreamingActions = Pick<
  GrpcStore,
  | "startStream"
  | "sendStreamMessage"
  | "closeSend"
  | "cancelStream"
  | "hydrate"
  | "clearTranscript"
>

/** Streaming-call slice of the gRPC store: lifecycle, transcript hydration. */
export const streamingActions: StateCreator<
  GrpcStore,
  [],
  [],
  StreamingActions
> = (set, get) => ({
  startStream: async (workspaceId, id, message) => {
    get().setStatus(id, "connecting")
    set((s) => ({
      transcripts: { ...s.transcripts, [id]: [] },
      timelines: { ...s.timelines, [id]: [] },
    }))
    const res = await commands.grpcStreamStart(
      workspaceId,
      id,
      activeEnvId(),
      authOverrideFor(workspaceId, id),
      message,
    )
    if (res.status !== "ok") get().setStatus(id, "error")
  },

  sendStreamMessage: async (workspaceId, id, message) => {
    await commands.grpcStreamSend(workspaceId, id, message, activeEnvId())
  },

  closeSend: async (id) => {
    await commands.grpcStreamCloseSend(id)
  },

  cancelStream: async (workspaceId, id) => {
    await commands.grpcStreamCancel(workspaceId, id)
  },

  hydrate: async (workspaceId, id) => {
    const [transcriptRes, activeRes] = await Promise.all([
      commands.grpcGetTranscript(workspaceId, id),
      commands.grpcIsActive(id),
    ])
    const active = activeRes.status === "ok" && activeRes.data
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [id]:
          transcriptRes.status === "ok"
            ? (transcriptRes.data.messages ?? [])
            : [],
      },
      timelines: {
        ...s.timelines,
        [id]:
          transcriptRes.status === "ok"
            ? (transcriptRes.data.events ?? [])
            : [],
      },
      status: { ...s.status, [id]: active ? "streaming" : "idle" },
    }))
  },

  clearTranscript: async (workspaceId, id) => {
    await commands.grpcClearTranscript(workspaceId, id)
    set((s) => ({
      transcripts: { ...s.transcripts, [id]: [] },
      timelines: { ...s.timelines, [id]: [] },
    }))
  },
})
