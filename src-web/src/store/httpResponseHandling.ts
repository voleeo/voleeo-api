import { errorMessage } from "@/lib/error"
import { useCookiesStore } from "@/store/cookies"
import type {
  HttpResponse,
  TimelineEvent,
} from "../../../packages/types/bindings"
import type { sendRequestCommand } from "./httpCommands"

interface HttpStoreSlice {
  responses: Record<string, HttpResponse>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
}

type SetHttpStore = (
  partial:
    | Partial<HttpStoreSlice>
    | ((s: HttpStoreSlice) => Partial<HttpStoreSlice>),
) => void

const ZERO_TIMING = {
  dnsMs: 0,
  connectMs: 0,
  tlsMs: 0,
  firstByteMs: 0,
  downloadMs: 0,
  totalMs: 0,
}

/** Applies the ok/cancelled/http_failed/generic-error branches of a `sendRequest`
 *  response to the store, including the ok-branch cookie-capture side effect. */
export function applySendRequestResult(
  set: SetHttpStore,
  workspaceId: string,
  requestId: string,
  res: Awaited<ReturnType<typeof sendRequestCommand>>,
  resolveEvents: TimelineEvent[],
): void {
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
      timing: ZERO_TIMING,
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
          timing: ZERO_TIMING,
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
}
