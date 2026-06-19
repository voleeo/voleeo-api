import { useMemo, useState } from "react"
import { useShallow } from "zustand/shallow"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { useUiStore } from "@/store/workspace"
import type {
  ImportDest,
  ImportPreview_Serialize as ImportPreview,
} from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import { FlowBtn } from "../FlowBtn"
import { FlowShell } from "../FlowShell"
import { ImportPreviewStep } from "./ImportPreviewStep"
import { ImportSourceStep } from "./ImportSourceStep"
import { formatLabel, requestIds } from "./importFilter"

interface CollectionImportFlowProps {
  onCancel: () => void
}

export function CollectionImportFlow({ onCancel }: CollectionImportFlowProps) {
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [destId, setDestId] = useState("new")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const selectedCount = useMemo(
    () =>
      preview
        ? requestIds(preview.tree).filter((id) => selected.has(id)).length
        : 0,
    [preview, selected],
  )

  async function loadPreview(text: string, label: string) {
    setContent(text)
    setSourceLabel(label)
    setBusy(true)
    setError("")
    try {
      const res = await commands.importPreview(null, text)
      if (res.status !== "ok") {
        setError(errorMessage(res.error))
        return
      }
      setPreview(res.data)
      setSelected(new Set(requestIds(res.data.tree)))
      setStep(2)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
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
      await loadWorkspaces()
      openWorkspace(res.data.workspaceId, "api")
    } finally {
      setBusy(false)
    }
  }

  const description =
    step === 1 || !preview ? (
      "Bring requests in from OpenAPI, Swagger, Postman, or Insomnia."
    ) : (
      <>
        Choose what to bring in from{" "}
        <span className="text-fg font-medium">{sourceLabel}</span> ·{" "}
        {formatLabel(preview.format, preview.formatVersion)}
      </>
    )

  return (
    <FlowShell
      icon="import"
      title="Import requests"
      description={description}
      wide={step === 2}
      footer={
        <div className="flex items-center justify-between w-full">
          <FlowBtn onClick={step === 1 ? onCancel : () => setStep(1)}>
            {step === 1 ? "Cancel" : "← Back"}
          </FlowBtn>
          {step === 2 && (
            <FlowBtn
              cta
              disabled={selectedCount === 0 || busy}
              onClick={commit}
            >
              {busy ? <Spinner className="size-3 shrink-0" /> : null}
              Import {selectedCount} request{selectedCount === 1 ? "" : "s"}
              <Glyph kind="arrow" size={14} color="var(--base00)" />
            </FlowBtn>
          )}
        </div>
      }
    >
      {step === 1 && (
        <ImportSourceStep onLoaded={loadPreview} onError={setError} />
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
