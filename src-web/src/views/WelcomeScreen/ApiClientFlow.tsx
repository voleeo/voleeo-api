import { useState } from "react"
import { useShallow } from "zustand/shallow"
import { Glyph } from "@/components/Glyph"
import { KeyDisplayCard } from "@/components/KeyDisplayCard"
import { MonoLabel } from "@/components/Primitives"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"
import { FlowBtn } from "./FlowBtn"
import { FlowShell } from "./FlowShell"

interface ApiClientFlowProps {
  onCancel: () => void
}

export function ApiClientFlow({ onCancel }: ApiClientFlowProps) {
  const { openWorkspace, loadWorkspaces } = useUiStore(
    useShallow((s) => ({
      openWorkspace: s.openWorkspace,
      loadWorkspaces: s.loadWorkspaces,
    })),
  )

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState("")
  const [encrypted, setEncrypted] = useState(false)
  const [keyDisplay, setKeyDisplay] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [invokeError, setInvokeError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setInvokeError(null)
    setSaving(true)
    try {
      const res = await commands.createWorkspace(
        name.trim() || "my-workspace",
        encrypted,
      )
      if (res.status !== "ok") {
        setInvokeError(errorMessage(res.error))
        return
      }
      await loadWorkspaces()
      if (encrypted) {
        const keyRes = await commands.workspaceGetKeyDisplay(res.data.id)
        if (keyRes.status === "ok") {
          setCreatedId(res.data.id)
          setKeyDisplay(keyRes.data)
          setStep(2)
          return
        }
      }
      openWorkspace(res.data.id, "api")
    } finally {
      setSaving(false)
    }
  }

  const footer =
    step === 1 ? (
      <div className="flex items-center justify-between w-full">
        <FlowBtn onClick={onCancel}>Cancel</FlowBtn>
        <FlowBtn cta disabled={saving || !name.trim()} onClick={handleCreate}>
          Create workspace
          <Glyph kind="arrow" size={14} color="var(--base00)" />
        </FlowBtn>
      </div>
    ) : (
      <div className="flex items-center justify-end w-full">
        <FlowBtn
          cta
          onClick={() => createdId && openWorkspace(createdId, "api")}
        >
          Open workspace
          <Glyph kind="arrow" size={14} color="var(--base00)" />
        </FlowBtn>
      </div>
    )

  return (
    <FlowShell
      icon="api"
      title="API Client"
      description="Design, send, and inspect your API."
      footer={footer}
    >
      {step === 1 ? (
        <>
          <div className="flex flex-col gap-[6px]">
            <div className="flex items-baseline gap-1">
              <MonoLabel size={9.5}>Workspace name</MonoLabel>
              <span className="text-[0.643rem] text-accent">*</span>
            </div>
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !saving && name.trim() && handleCreate()
              }
              placeholder="my-workspace"
              className="px-3 py-2.5 border border-border rounded-[5px] bg-bg text-[0.929rem] text-fg outline-none select-text placeholder:text-muted"
            />
          </div>

          <div className="flex flex-col gap-2">
            <MonoLabel size={9.5}>Encryption</MonoLabel>
            <div className="flex items-center gap-2.5">
              <Switch checked={encrypted} onCheckedChange={setEncrypted} />
              <span className="font-sans text-[0.857rem] text-fg">
                {encrypted ? "On" : "Off"}
              </span>
            </div>
            {encrypted && (
              <>
                <p className="font-sans text-[0.857rem] text-muted leading-relaxed">
                  Passwords and secrets will be encrypted with a
                  workspace-specific key stored in your system keychain.
                </p>
                <StepIndicator current={1} total={2} />
              </>
            )}
          </div>

          {invokeError && (
            <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-2">
              {invokeError}
            </div>
          )}
        </>
      ) : (
        <>
          <StepIndicator current={2} total={2} label="save your key" />
          <p className="font-sans text-[0.929rem] text-fg leading-relaxed">
            Store this key somewhere safe. If you lose it, encrypted data in
            this workspace cannot be recovered.
          </p>
          <KeyDisplayCard displayKey={keyDisplay ?? ""} />
        </>
      )}
    </FlowShell>
  )
}

function StepIndicator({
  current,
  total,
  label,
}: {
  current: number
  total: number
  label?: string
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div
          key={step}
          className={cn(
            "h-1 w-6 rounded-full",
            step <= current ? "bg-accent" : "bg-border",
          )}
        />
      ))}
      <span className="text-[0.714rem] text-muted">
        step {current} of {total}
        {label ? ` · ${label}` : ""}
      </span>
    </div>
  )
}
