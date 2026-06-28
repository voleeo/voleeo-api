import { useCallback, useMemo, useState } from "react"
import { useShallow } from "zustand/shallow"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import type {
  ImportDest,
  ImportPreview_Serialize as ImportPreview,
  VoleeoBundlePreview_Serialize as VoleeoBundlePreview,
} from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import { FlowBtn } from "../FlowBtn"
import { FlowShell } from "../FlowShell"
import { ImportPreviewStep } from "./ImportPreviewStep"
import { ImportSourceStep } from "./ImportSourceStep"
import { formatLabel, requestIds } from "./importFilter"
import { VoleeoBundlePreviewStep } from "./VoleeoBundlePreviewStep"

interface ImportRequestsFlowProps {
  onCancel: () => void
  defaultDestId?: string
  embedded?: boolean
}

export function ImportRequestsFlow({
  onCancel,
  defaultDestId,
  embedded,
}: ImportRequestsFlowProps) {
  const { workspaces, openWorkspace, loadWorkspaces } = useUiStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      openWorkspace: s.openWorkspace,
      loadWorkspaces: s.loadWorkspaces,
    })),
  )

  const [step, setStep] = useState<1 | 2>(1)
  const [content, setContent] = useState("")
  const [sourceLabel, setSourceLabel] = useState("")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [bundlePreview, setBundlePreview] =
    useState<VoleeoBundlePreview | null>(null)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(
    new Set(),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [destId, setDestId] = useState(defaultDestId ?? "new")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const selectedCount = useMemo(
    () =>
      preview
        ? requestIds(preview.tree).filter((id) => selected.has(id)).length
        : 0,
    [preview, selected],
  )
  const bundleRequestCount = useMemo(
    () =>
      bundlePreview?.workspaces
        .filter((w) => selectedWorkspaces.has(w.id))
        .reduce((a, w) => a + w.requestCount, 0) ?? 0,
    [bundlePreview, selectedWorkspaces],
  )
  const toggleWorkspace = useCallback((id: string) => {
    setSelectedWorkspaces((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }, [])

  async function openImported(workspaceId: string) {
    await loadWorkspaces()
    openWorkspace(workspaceId, "api")
    const reqStore = useRequestStore.getState()
    if (reqStore.loadedWorkspaceId === workspaceId) await reqStore.reload()
    if (embedded) onCancel()
  }

  async function loadPreview(text: string, label: string) {
    setContent(text)
    setSourceLabel(label)
    setBusy(true)
    setError("")
    try {
      // A native Voleeo Bundle restores whole workspaces as-is — preview its
      // contents for confirmation rather than building a cherry-pick tree.
      if (/^\s*voleeoBundle\s*:/m.test(text)) {
        const res = await commands.importVoleeoPreview(text)
        if (res.status !== "ok") {
          setError(errorMessage(res.error))
          return
        }
        setPreview(null)
        setBundlePreview(res.data)
        setSelectedWorkspaces(new Set(res.data.workspaces.map((w) => w.id)))
        setStep(2)
        return
      }

      const res = await commands.importPreview(null, text)
      if (res.status !== "ok") {
        setError(errorMessage(res.error))
        return
      }
      setBundlePreview(null)
      setPreview(res.data)
      setSelected(new Set(requestIds(res.data.tree)))
      setStep(2)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (bundlePreview) {
      setBusy(true)
      setError("")
      try {
        const res = await commands.importVoleeo(content, [
          ...selectedWorkspaces,
        ])
        if (res.status !== "ok") {
          setError(errorMessage(res.error))
          return
        }
        await openImported(res.data.workspaceId)
      } finally {
        setBusy(false)
      }
      return
    }
    if (!preview || selectedCount === 0) return
    setBusy(true)
    setError("")
    try {
      const name =
        preview.suggestedName.trim() ||
        sourceLabel.replace(/\.(json|ya?ml)$/i, "") ||
        "imported-api"
      const dest: ImportDest =
        destId === "new"
          ? { kind: "new_workspace", data: { name, encrypted: false } }
          : {
              kind: "existing_workspace",
              data: { workspace_id: destId, parent_folder_id: null },
            }
      const res = await commands.importCommit(preview.format, content, dest, [
        ...selected,
      ])
      if (res.status !== "ok") {
        setError(errorMessage(res.error))
        return
      }
      await openImported(res.data.workspaceId)
    } finally {
      setBusy(false)
    }
  }

  const description =
    step === 1 ? (
      "Bring requests in from OpenAPI, Swagger, Postman, or Insomnia."
    ) : bundlePreview ? (
      <>
        Restore everything from{" "}
        <span className="text-fg font-medium">{sourceLabel}</span> · Voleeo
        Bundle
      </>
    ) : preview ? (
      <>
        Choose what to bring in from{" "}
        <span className="text-fg font-medium">{sourceLabel}</span> ·{" "}
        {formatLabel(preview.format, preview.formatVersion)}
      </>
    ) : (
      "Bring requests in from OpenAPI, Swagger, Postman, or Insomnia."
    )

  return (
    <FlowShell
      icon="import"
      title="Import requests"
      description={description}
      wide={step === 2}
      autoResizeWindow={!embedded}
      footer={
        <div className="flex items-center justify-between w-full">
          <FlowBtn onClick={step === 1 ? onCancel : () => setStep(1)}>
            {step === 1 ? "Cancel" : "← Back"}
          </FlowBtn>
          {step === 2 && (
            <FlowBtn
              cta
              disabled={
                busy ||
                (bundlePreview
                  ? selectedWorkspaces.size === 0
                  : selectedCount === 0)
              }
              onClick={commit}
            >
              {busy ? <Spinner className="size-3 shrink-0" /> : null}
              {bundlePreview
                ? `Import ${bundleRequestCount} request${bundleRequestCount === 1 ? "" : "s"}`
                : `Import ${selectedCount} request${selectedCount === 1 ? "" : "s"}`}
              <Glyph kind="arrow" size={14} color="var(--base00)" />
            </FlowBtn>
          )}
        </div>
      }
    >
      {step === 1 && (
        <ImportSourceStep onLoaded={loadPreview} onError={setError} />
      )}
      {step === 2 && bundlePreview && (
        <VoleeoBundlePreviewStep
          preview={bundlePreview}
          selected={selectedWorkspaces}
          onToggle={toggleWorkspace}
        />
      )}
      {step === 2 && preview && (
        <ImportPreviewStep
          preview={preview}
          selected={selected}
          onChange={setSelected}
          workspaces={workspaces}
          destId={destId}
          onDestChange={setDestId}
        />
      )}

      {busy && step === 1 && (
        <div className="flex items-center gap-2 text-[0.786rem] text-muted">
          <Spinner className="size-3 shrink-0" /> Parsing
        </div>
      )}
      {error && (
        <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-2">
          {error}
        </div>
      )}
    </FlowShell>
  )
}
