import { create } from "zustand"

import type { ResolutionEvent } from "@/lib/template"
import { useSseStore } from "@/store/sse"
import type { SentRequestSnapshot } from "@/views/ApiWorkspace/SentRequestInspector/types"
import type {
  AuthConfig,
  HttpResponse,
  RequestBody,
  RequestParameter,
  StoredCookie_Deserialize,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"
import { resolutionToTimelineEvents, sendRequestCommand } from "./httpCommands"
import { applySendRequestResult } from "./httpResponseHandling"

export type { SendRequestOptions } from "./httpCommands"
export { sendRequestCommand, signAuthHeaders } from "./httpCommands"

interface HttpStore {
  responses: Record<string, HttpResponse>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
  lastSent: Record<string, SentRequestSnapshot>
  setLastSent: (requestId: string, snapshot: SentRequestSnapshot) => void
  clearAllSent: () => void
  sendRequest: (
    workspaceId: string,
    requestId: string,
    urlOverride?: string,
    bodyOverride?: RequestBody | null,
    headersOverride?: RequestParameter[],
    resolutionEvents?: ResolutionEvent[],
    environmentId?: string | null,
    cookieOverrides?: StoredCookie_Deserialize[] | null,
    authOverride?: AuthConfig | null,
  ) => Promise<void>
  cancelRequest: (requestId: string) => Promise<void>
  /** Mark a request as in-flight before template resolution starts, so the
   *  spinner covers slow resolvers (ask prompts, 1Password reads) — the
   *  response timer itself only ever measures the HTTP exchange. */
  setLoading: (requestId: string, loading: boolean) => void
  clearResponse: (requestId: string) => void
  /** Surface a send-pipeline failure (e.g. a thrown OAuth token fetch) as the
   *  request's error banner, and clear any stuck loading state. */
  setError: (requestId: string, message: string) => void
}

export const useHttpStore = create<HttpStore>((set) => ({
  responses: {},
  loading: {},
  errors: {},
  lastSent: {},

  setLastSent: (requestId, snapshot) =>
    set((s) => ({ lastSent: { ...s.lastSent, [requestId]: snapshot } })),
  clearAllSent: () => set({ lastSent: {} }),

  sendRequest: async (
    workspaceId,
    requestId,
    urlOverride,
    bodyOverride,
    headersOverride,
    resolutionEvents,
    environmentId,
    cookieOverrides,
    authOverride,
  ) => {
    set((s) => ({
      loading: { ...s.loading, [requestId]: true },
      errors: { ...s.errors, [requestId]: undefined },
    }))

    useSseStore.getState().clear(requestId)

    const resolveEvents = resolutionToTimelineEvents(resolutionEvents ?? [])
    const resolutionNotes = resolveEvents.map((e) => e.text)

    let res: Awaited<ReturnType<typeof sendRequestCommand>>
    try {
      res = await sendRequestCommand(workspaceId, requestId, {
        urlOverride,
        bodyOverride,
        headersOverride,
        resolutionNotes: resolutionNotes.length > 0 ? resolutionNotes : null,
        environmentId,
        cookieOverrides,
        authOverride,
      })
    } catch (e) {
      // An IPC-layer throw (serialization, panic) would otherwise leave
      // `loading` stuck true, wedging the send button into cancel mode.
      set((s) => ({
        loading: { ...s.loading, [requestId]: false },
        errors: {
          ...s.errors,
          [requestId]: e instanceof Error ? e.message : String(e),
        },
      }))
      return
    }

    applySendRequestResult(set, workspaceId, requestId, res, resolveEvents)
  },

  cancelRequest: async (requestId) => {
    set((s) => ({ loading: { ...s.loading, [requestId]: false } }))
    await commands.cancelRequest(requestId)
  },

  setLoading: (requestId, loading) =>
    set((s) => ({ loading: { ...s.loading, [requestId]: loading } })),

  setError: (requestId, message) =>
    set((s) => ({
      loading: { ...s.loading, [requestId]: false },
      errors: { ...s.errors, [requestId]: message },
    })),

  clearResponse: (requestId) => {
    useSseStore.getState().clear(requestId)
    set((s) => {
      const responses = { ...s.responses }
      delete responses[requestId]
      const errors = { ...s.errors }
      delete errors[requestId]
      const loading = { ...s.loading }
      delete loading[requestId]
      const lastSent = { ...s.lastSent }
      delete lastSent[requestId]
      return { responses, errors, loading, lastSent }
    })
  },
}))
