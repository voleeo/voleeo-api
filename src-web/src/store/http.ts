import { create } from "zustand"

import { errorMessage } from "@/lib/error"
import type { ResolutionEvent } from "@/lib/template"
import { useCookiesStore } from "@/store/cookies"
import type { SentRequestSnapshot } from "@/views/ApiWorkspace/SentRequestInspector/types"
import type {
  AuthConfig,
  HttpResponse,
  RequestBody,
  RequestParameter,
  StoredCookie_Deserialize,
  TimelineEvent,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"

/** Pre-flight resolution observations rendered as `atMs: 0` Timeline events. */
function resolutionToTimelineEvents(
  resolutions: ResolutionEvent[],
): TimelineEvent[] {
  return resolutions.map((r) => ({
    atMs: 0,
    kind: "resolve",
    text: `${r.label}: ${r.source} → ${JSON.stringify(r.result)}`,
  }))
}

export interface SendRequestOptions {
  urlOverride?: string | null
  bodyOverride?: RequestBody | null
  headersOverride?: RequestParameter[] | null
  calledFrom?: string | null
  resolutionNotes?: string[] | null
  environmentId?: string | null
  cookieOverrides?: StoredCookie_Deserialize[] | null
  authOverride?: AuthConfig | null
}

export function sendRequestCommand(
  workspaceId: string,
  requestId: string,
  opts: SendRequestOptions = {},
) {
  return commands.sendRequest(workspaceId, requestId, {
    url: opts.urlOverride ?? null,
    body: opts.bodyOverride ?? null,
    headers: opts.headersOverride ?? null,
    calledFrom: opts.calledFrom ?? null,
    resolutionNotes: opts.resolutionNotes ?? null,
    environmentId: opts.environmentId ?? null,
    cookieOverrides: opts.cookieOverrides ?? null,
    authOverride: opts.authOverride ?? null,
  })
}

export async function signAuthHeaders(
  auth: AuthConfig,
  method: string,
  url: string,
  body: RequestBody | null,
): Promise<RequestParameter[]> {
  const res = await commands.signAuthHeaders(auth, method, url, body)
  return res.status === "ok" ? res.data : []
}

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
  clearResponse: (requestId: string) => void
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

    const resolveEvents = resolutionToTimelineEvents(resolutionEvents ?? [])
    const resolutionNotes = resolveEvents.map((e) => e.text)

    const res = await sendRequestCommand(workspaceId, requestId, {
      urlOverride,
      bodyOverride,
      headersOverride,
      resolutionNotes: resolutionNotes.length > 0 ? resolutionNotes : null,
      environmentId,
      cookieOverrides,
      authOverride,
    })

    if (res.status === "ok") {
      const captured = res.data.capturedCookies ?? []
      // Resolution events were prepended by Rust — don't re-merge here.
      const merged: HttpResponse = { ...res.data }
      if (captured.length > 0) {
        const cookiesState = useCookiesStore.getState()
        const jar = cookiesState.jars.find(
          (j) => j.id === cookiesState.activeJarId,
        )
        const jarName = jar?.name ?? "active jar"
        merged.events = [
          ...(merged.events ?? []),
          {
            atMs: 0,
            kind: "resolve",
            text: `${captured.length} cookie${captured.length === 1 ? "" : "s"} captured into ${jarName}`,
          },
        ]
        // Fire-and-forget refresh so an open Cookies modal sees new entries.
        if (cookiesState.loadedWorkspaceId === workspaceId) {
          void cookiesState.reload()
        }
      }
      set((s) => ({
        loading: { ...s.loading, [requestId]: false },
        responses: { ...s.responses, [requestId]: merged },
        errors: { ...s.errors, [requestId]: undefined },
      }))
      return
    }

    if (res.error.kind === "cancelled") {
      const shell: HttpResponse = {
        requestId,
        status: 0,
        statusText: "",
        headers: [],
        body: "",
        bodySize: 0,
        bodyIsText: true,
        timing: {
          dnsMs: 0,
          connectMs: 0,
          tlsMs: 0,
          firstByteMs: 0,
          downloadMs: 0,
          totalMs: 0,
        },
        events: [
          ...resolveEvents,
          { atMs: 0, kind: "info", text: "Request cancelled" },
        ],
      }
      set((s) => ({
        loading: { ...s.loading, [requestId]: false },
        responses: { ...s.responses, [requestId]: shell },
        errors: { ...s.errors, [requestId]: undefined },
      }))
      return
    }

    const errMsg = errorMessage(res.error)
    const shellResponse: HttpResponse | undefined =
      res.error.kind === "http_failed"
        ? {
            requestId,
            status: 0,
            statusText: "",
            headers: [],
            body: "",
            bodySize: 0,
            bodyIsText: true,
            timing: {
              dnsMs: 0,
              connectMs: 0,
              tlsMs: 0,
              firstByteMs: 0,
              downloadMs: 0,
              totalMs: 0,
            },
            events: [...resolveEvents, ...res.error.data.events],
          }
        : undefined

    set((s) => {
      const nextResponses = { ...s.responses }
      if (shellResponse) {
        nextResponses[requestId] = shellResponse
      } else {
        delete nextResponses[requestId]
      }
      return {
        loading: { ...s.loading, [requestId]: false },
        responses: nextResponses,
        errors: { ...s.errors, [requestId]: errMsg },
      }
    })
  },

  cancelRequest: async (requestId) => {
    await commands.cancelRequest(requestId)
  },

  clearResponse: (requestId) => {
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
