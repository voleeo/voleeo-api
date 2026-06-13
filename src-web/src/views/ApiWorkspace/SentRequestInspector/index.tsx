import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { isAbortError } from "@/lib/abort"
import { cn } from "@/lib/utils"
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
import { buildCurl } from "./buildCurl"
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

  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
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
  const [copied, setCopied] = useState(false)

  // Compute preview against the current draft.
  useEffect(() => {
    let cancelled = false
    if (!activeWorkspaceId || !activeRequest || !activeWorkspace) return
    setPreviewing(true)
    setPreviewError(null)
    const vars = mergeEnvVars(
      environments.find((e) => e.kind === "global")?.variables ?? [],
      environments.find((e) => e.id === activeEnvId)?.variables ?? [],
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
        if (payload.dynamicAuthOverride) {
          signedAuthHeaders = await signAuthHeaders(
            payload.dynamicAuthOverride,
            activeRequest.method,
            payload.fullUrl,
            payload.body,
          )
          if (cancelled) return
        }
        setPreview(
          buildSentSnapshot({
            request: activeRequest,
            payload,
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
    activeJar,
    cookiesLoadedWorkspaceId,
    templateFns,
  ])

  const handleCopyCurl = async () => {
    if (!preview) return
    try {
      await navigator.clipboard.writeText(buildCurl(preview))
      setCopied(true)
      setTimeout(() => setCopied(false), 1300)
    } catch {
      /* no-op */
    }
  }

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

        {/* Footer */}
        <div className="flex items-center px-4 py-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={handleCopyCurl}
            disabled={!preview}
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] border bg-bg font-sans text-[0.786rem] cursor-pointer transition-colors outline-none",
              copied
                ? "border-success/40 text-success"
                : "border-border text-muted hover:text-fg",
              !preview && "opacity-50 cursor-not-allowed",
            )}
          >
            <Glyph
              kind={copied ? "check" : "copy"}
              size={11}
              color="currentColor"
            />
            {copied ? "Copied" : "Copy as cURL"}
          </button>
        </div>
      </div>
    </ManagementModal>
  )
}
