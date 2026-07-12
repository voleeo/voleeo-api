import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { ManagementModal } from "@/components/ManagementModal"
import { isAbortError } from "@/lib/abort"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useCookiesStore } from "@/store/cookies"
import { useEnvironmentStore } from "@/store/environment"
import { signAuthHeaders } from "@/store/http"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { storedPathParams } from "../paramUtils"
import {
  buildSentSnapshot,
  mergeEnvVars,
  resolveSendPayload,
} from "../sendResolution"
import { SentRequestSummary } from "./SentRequestSummary"
import type { SentRequestSnapshot } from "./types"

interface Props {
  onClose: () => void
}

export function SentRequestInspector({ onClose }: Props) {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const activeWorkspace = useUiStore((s) =>
    s.activeWorkspaceId
      ? (s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null)
      : null,
  )
  const activeRequest = useRequestStore((s) =>
    s.activeRequestId
      ? (s.requests.find((r) => r.id === s.activeRequestId) ?? null)
      : null,
  )
  const folders = useRequestStore(useShallow((s) => s.folders))

  const { environments, activeEnvId, systemEnvVars } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
      systemEnvVars: s.systemEnvVars,
    })),
  )
  const { activeJar, cookiesLoadedWorkspaceId } = useCookiesStore(
    useShallow((s) => ({
      activeJar: s.jars.find((j) => j.id === s.activeJarId) ?? null,
      cookiesLoadedWorkspaceId: s.loadedWorkspaceId,
    })),
  )
  const templateFns = useTemplateFunctions()

  const [preview, setPreview] = useState<SentRequestSnapshot | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Compute preview against the current draft.
  useEffect(() => {
    let cancelled = false
    if (!activeWorkspaceId || !activeRequest || !activeWorkspace) return
    setPreviewing(true)
    setPreviewError(null)
    const vars = mergeEnvVars(
      environments.find((e) => e.kind === "global")?.variables ?? [],
      environments.find((e) => e.id === activeEnvId)?.variables ?? [],
      systemEnvVars,
    )
    const jarForSend =
      cookiesLoadedWorkspaceId === activeWorkspaceId ? activeJar : null
    ;(async () => {
      try {
        const pathParams = storedPathParams(activeRequest)
        const payload = await resolveSendPayload({
          request: activeRequest,
          urlDraft: activeRequest.url,
          pathParamValues: pathParams.values,
          pathParamEnabled: pathParams.enabled,
          vars,
          templateFns,
          folders,
          workspace: activeWorkspace,
          activeJar: jarForSend,
        })
        if (cancelled) return
        let signedAuthHeaders: { name: string; value: string }[] = []
        let signedAuthQuery: { name: string; value: string }[] = []
        if (payload.dynamicAuthOverride) {
          const signed = await signAuthHeaders(
            payload.dynamicAuthOverride,
            activeRequest.method,
            payload.fullUrl,
            payload.body,
          )
          if (cancelled) return
          signedAuthHeaders = signed.headers
          signedAuthQuery = signed.query
        }
        // OAuth 1.0 query placement appends to the URL.
        const previewPayload =
          signedAuthQuery.length > 0
            ? {
                ...payload,
                fullUrl:
                  payload.fullUrl +
                  (payload.fullUrl.includes("?") ? "&" : "?") +
                  signedAuthQuery
                    .map(
                      (p) =>
                        `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`,
                    )
                    .join("&"),
              }
            : payload
        setPreview(
          buildSentSnapshot({
            request: activeRequest,
            payload: previewPayload,
            capturedAt: null,
            signedAuthHeaders,
          }),
        )
      } catch (e) {
        if (cancelled || isAbortError(e)) return
        setPreviewError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    activeRequest,
    activeWorkspaceId,
    activeWorkspace,
    folders,
    environments,
    activeEnvId,
    systemEnvVars,
    activeJar,
    cookiesLoadedWorkspaceId,
    templateFns,
  ])

  return (
    <ManagementModal
      width={680}
      fitContent
      onClose={onClose}
      title={
        <span className="font-sans text-[1rem] font-semibold text-fg">
          Inspect request
        </span>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          {previewError ? (
            <div className="px-5 py-6 font-sans text-[0.857rem] text-error">
              Preview failed: {previewError}
            </div>
          ) : preview ? (
            <SentRequestSummary snapshot={preview} maskSecrets />
          ) : (
            <div className="px-5 py-6 font-sans text-[0.857rem] text-muted">
              {previewing ? "Resolving…" : "Nothing to show."}
            </div>
          )}
        </div>
      </div>
    </ManagementModal>
  )
}
