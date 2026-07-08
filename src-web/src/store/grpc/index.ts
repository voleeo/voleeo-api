import { create } from "zustand"
import { capPush } from "@/lib/boundedArray"
import { errorMessage } from "@/lib/error"
import { commands } from "../../../../packages/types/bindings"
import { activeEnvId, authOverrideFor } from "./shared"
import { streamingActions } from "./streaming"
import type { GrpcStore } from "./types"

export type { GrpcStatus, GrpcStore } from "./types"

type ServicesResult = Awaited<ReturnType<typeof commands.grpcListServices>>

export const useGrpcStore = create<GrpcStore>((set, get, api) => {
  /** Shared by load/refresh: spinner on, store services or the error. */
  const fetchServices = async (
    id: string,
    run: () => Promise<ServicesResult>,
  ) => {
    set((s) => ({ refreshing: { ...s.refreshing, [id]: true } }))
    const res = await run()
    if (res.status !== "ok") {
      set((s) => ({
        refreshing: { ...s.refreshing, [id]: false },
        errors: { ...s.errors, [id]: errorMessage(res.error) },
      }))
      return []
    }
    set((s) => ({
      refreshing: { ...s.refreshing, [id]: false },
      services: { ...s.services, [id]: res.data },
      errors: { ...s.errors, [id]: undefined },
    }))
    return res.data
  }

  return {
    status: {},
    transcripts: {},
    timelines: {},
    services: {},
    refreshing: {},
    responses: {},
    loading: {},
    errors: {},

    setStatus: (id, status) =>
      set((s) =>
        s.status[id] === status ? s : { status: { ...s.status, [id]: status } },
      ),

    appendMessage: (id, message) =>
      set((s) => {
        const current = s.transcripts[id] ?? []
        if (current.some((m) => m.id === message.id)) return s
        return {
          transcripts: { ...s.transcripts, [id]: capPush(current, message) },
        }
      }),

    appendTimeline: (id, event) =>
      set((s) => {
        const current = s.timelines[id] ?? []
        return { timelines: { ...s.timelines, [id]: capPush(current, event) } }
      }),

    loadServices: (workspaceId, id) =>
      fetchServices(id, () =>
        commands.grpcListServices(workspaceId, id, activeEnvId()),
      ),

    refreshServices: (workspaceId, id) =>
      fetchServices(id, () =>
        commands.grpcRefreshDescriptors(workspaceId, id, activeEnvId()),
      ),

    describeMethod: async (workspaceId, id, service, method) => {
      const res = await commands.grpcDescribeMethod(
        workspaceId,
        id,
        service,
        method,
        activeEnvId(),
      )
      return res.status === "ok" ? res.data : null
    },

    call: async (workspaceId, id, message) => {
      set((s) => ({
        loading: { ...s.loading, [id]: true },
        errors: { ...s.errors, [id]: undefined },
      }))
      const res = await commands.grpcCall(
        workspaceId,
        id,
        activeEnvId(),
        authOverrideFor(workspaceId, id),
        message,
      )
      if (res.status === "ok") {
        set((s) => ({
          responses: { ...s.responses, [id]: res.data },
          loading: { ...s.loading, [id]: false },
        }))
      } else {
        const msg = errorMessage(res.error)
        set((s) => ({
          loading: { ...s.loading, [id]: false },
          errors: { ...s.errors, [id]: msg },
        }))
      }
    },

    cancel: async (id) => {
      await commands.grpcCancel(id)
    },

    clearResponse: (id) => {
      set((s) => {
        const responses = { ...s.responses }
        const errors = { ...s.errors }
        delete responses[id]
        delete errors[id]
        return { responses, errors }
      })
    },

    ...streamingActions(set, get, api),
  }
})
