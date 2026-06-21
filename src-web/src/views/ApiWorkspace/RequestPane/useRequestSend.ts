import type { RefObject } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  clearResponseCycleCache,
  pendingPreflightEvents,
} from "@/builtins/response"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { isAbortError } from "@/lib/abort"
import { pathFromUrl } from "@/lib/requestName"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useCookiesStore } from "@/store/cookies"
import { useEnvironmentStore } from "@/store/environment"
import { useHttpStore } from "@/store/http"
import type { HttpRequest } from "@/store/requests"
import { DEFAULT_REQUEST_NAME, useRequestStore } from "@/store/requests"
import type { Workspace } from "@/store/workspace"
import {
  buildSentSnapshot,
  mergeEnvVars,
  resolveSendPayload,
} from "../sendResolution"
import type { RequestDraft } from "./useRequestDraft"

interface Params {
  activeWorkspaceId: string | null
  activeWorkspace: Workspace | null
  activeRequest: HttpRequest | null
  draft: RequestDraft
  headersCommitRef: RefObject<() => Promise<void>>
  bodyCommitRef: RefObject<() => Promise<void>>
  authCommitRef: RefObject<() => Promise<void>>
}

/** Owns the send pipeline: commit pending edits, resolve templates, snapshot,
 *  then dispatch (or cancel) the network request. Also wires the send/cancel
 *  keyboard shortcuts. */
export function useRequestSend({
  activeWorkspaceId,
  activeWorkspace,
  activeRequest,
  draft,
  headersCommitRef,
  bodyCommitRef,
  authCommitRef,
}: Params) {
  const updateRequest = useRequestStore((s) => s.updateRequest)
  const renameRequest = useRequestStore((s) => s.renameRequest)

  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
    })),
  )
  // Active jar feeds sendResolution.ts so plugin-function cookie templates
  // (`{{ uuid.v4() }}`, etc.) resolve frontend-side — Rust can't run them.
  const { activeJar, cookiesLoadedWorkspaceId } = useCookiesStore(
    useShallow((s) => ({
      activeJar: s.jars.find((j) => j.id === s.activeJarId) ?? null,
      cookiesLoadedWorkspaceId: s.loadedWorkspaceId,
    })),
  )
  const templateFns = useTemplateFunctions()
  const sendRequest = useHttpStore((s) => s.sendRequest)
  const cancelRequest = useHttpStore((s) => s.cancelRequest)
  const isSending = useHttpStore((s) =>
    activeRequest ? Boolean(s.loading[activeRequest.id]) : false,
  )

  async function commitUrl() {
    if (!activeWorkspaceId || !activeRequest) return
    if (draft.urlDraft === activeRequest.url) return
    await updateRequest(
      activeWorkspaceId,
      activeRequest.id,
      activeRequest.method,
      draft.urlDraft,
      activeRequest.parameters ?? [],
      activeRequest.headers ?? [],
      activeRequest.body ?? null,
    )
    if (activeRequest.name === DEFAULT_REQUEST_NAME) {
      const path = pathFromUrl(draft.urlDraft)
      if (path) await renameRequest(activeWorkspaceId, activeRequest.id, path)
    }
  }

  /** Commit any pending URL edit, substitute all template expressions, then send. */
  async function handleSend() {
    if (!activeWorkspaceId || !activeRequest || !activeWorkspace) return
    await Promise.all([
      commitUrl(),
      headersCommitRef.current(),
      bodyCommitRef.current(),
      authCommitRef.current(),
    ])

    const vars = mergeEnvVars(
      environments.find((e) => e.kind === "global")?.variables ?? [],
      environments.find((e) => e.id === activeEnvId)?.variables ?? [],
    )
    clearResponseCycleCache()
    // Skip cookie overrides if the store's jar belongs to a different workspace.
    const jarForSend =
      cookiesLoadedWorkspaceId === activeWorkspaceId ? activeJar : null

    let payload: Awaited<ReturnType<typeof resolveSendPayload>>
    try {
      payload = await resolveSendPayload({
        request: activeRequest,
        urlDraft: draft.urlDraft,
        pathParamValues: draft.pathParamValues,
        pathParamEnabled: draft.pathParamEnabled,
        vars,
        templateFns,
        folders: useRequestStore.getState().folders,
        workspace: activeWorkspace,
        activeJar: jarForSend,
        forSend: true,
      })
    } catch (e) {
      // Cancelled ask() prompt — abort silently.
      if (isAbortError(e)) return
      useHttpStore
        .getState()
        .setError(activeRequest.id, e instanceof Error ? e.message : String(e))
      return
    }

    const preflightEvents = pendingPreflightEvents.splice(0)

    // Capture a snapshot BEFORE invoking the network so the inspector reflects
    // what was attempted, even if the network errors out.
    useHttpStore.getState().setLastSent(
      activeRequest.id,
      buildSentSnapshot({
        request: activeRequest,
        payload,
        capturedAt: Date.now(),
      }),
    )

    await sendRequest(
      activeWorkspaceId,
      activeRequest.id,
      // Only override the URL when it actually differs from what's stored.
      payload.fullUrl !== activeRequest.url ? payload.fullUrl : undefined,
      payload.body,
      payload.headers,
      [...preflightEvents, ...payload.resolutionEvents],
      activeEnvId,
      payload.cookies,
      payload.dynamicAuthOverride,
    )
  }

  function commitMethod(next: string) {
    if (!activeWorkspaceId || !activeRequest) return
    if (next === activeRequest.method) return
    void updateRequest(
      activeWorkspaceId,
      activeRequest.id,
      next,
      activeRequest.url,
      activeRequest.parameters ?? [],
      activeRequest.headers ?? [],
      activeRequest.body ?? null,
    )
  }

  function cancelActive() {
    if (activeRequest) void cancelRequest(activeRequest.id)
  }

  function sendOrCancel() {
    if (!activeRequest) return
    if (isSending) void cancelRequest(activeRequest.id)
    else void handleSend()
  }
  useKeydown(SHORTCUTS.SEND_REQUEST, sendOrCancel)

  return { isSending, commitUrl, commitMethod, handleSend, cancelActive }
}
