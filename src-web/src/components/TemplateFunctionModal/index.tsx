import { useEffect, useRef, useState } from "react"
import type { BoundTemplateFunction } from "@/plugins/types"
import { useUiStore } from "@/store/workspace"
import { ArgInput } from "./ArgInput"
import { ModalHeader } from "./ModalHeader"
import { PreviewBlock } from "./PreviewBlock"
import { useTemplatePreview } from "./useTemplatePreview"
import { groupArgsByRow } from "./utils"

interface Props {
  fn: BoundTemplateFunction
  initialArgs?: Record<string, string>
  onInsert: (args: Record<string, string>) => void
  onClose: () => void
  confirmLabel?: string
  iconLabel?: string
  hidePreview?: boolean
}

export function TemplateFunctionModal({
  fn,
  initialArgs = {},
  onInsert,
  onClose,
  confirmLabel = "Insert",
  iconLabel = "f",
  hidePreview = false,
}: Props) {
  const args = fn.args ?? []
  const isEncryptionEnabled = useUiStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.encrypted ?? false
  })

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const arg of args) {
      init[arg.name] = initialArgs[arg.name] ?? arg.defaultValue ?? ""
    }
    return init
  })
  const [focusedArg, setFocusedArg] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const preview = useTemplatePreview(
    fn,
    values,
    isEncryptionEnabled,
    !hidePreview,
  )

  // Merge an async decrypt-push from the parent (e.g. an enc: arg) into state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on initialArgs identity change
  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev }
      let changed = false
      for (const arg of args) {
        const incoming = initialArgs[arg.name]
        if (incoming !== undefined && incoming !== prev[arg.name]) {
          next[arg.name] = incoming
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [initialArgs])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const first = root.querySelector<HTMLElement>(
      'input:not([type="checkbox"]):not([disabled]), textarea:not([disabled])',
    )
    if (first) {
      first.focus()
      if (
        first instanceof HTMLInputElement ||
        first instanceof HTMLTextAreaElement
      ) {
        first.select()
      }
    } else {
      root.focus()
    }
  }, [])

  const visibleArgs = args.filter(
    (arg) =>
      !arg.visibleWhen ||
      Object.entries(arg.visibleWhen).every(
        ([k, v]) => (values[k] ?? "") === v,
      ),
  )
  const missingRequired = visibleArgs.some(
    (a) => a.required && (values[a.name] ?? "") === "",
  )

  function setValue(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
    preview.clear()
  }

  function handleInsert() {
    if (missingRequired) return
    onInsert(values)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      const target = e.target as HTMLElement
      if (target.tagName === "TEXTAREA" && !e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      handleInsert()
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      ref={rootRef}
      data-template-fn-modal=""
      tabIndex={-1}
      className="fixed inset-0 z-300 bg-black/50 flex items-center justify-center outline-none"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.6)] w-[420px] max-w-[96vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader fn={fn} iconLabel={iconLabel} onClose={onClose} />

        {visibleArgs.length > 0 && (
          <div className="px-4 py-4 flex flex-col gap-3 border-b border-border">
            {groupArgsByRow(visibleArgs).map((group) => {
              const head = group[0]
              return (
                <div
                  key={head.row ?? head.name}
                  className="flex flex-col gap-1.5"
                >
                  <label className="font-sans text-[0.786rem] text-muted font-medium">
                    {head.label ?? head.name}
                    {head.required && (
                      <span className="text-accent ml-0.5">*</span>
                    )}
                    {head.description && (
                      <span className="ml-1.5 font-normal text-muted/60">
                        — {head.description}
                      </span>
                    )}
                  </label>
                  {group.length > 1 ? (
                    <div className="flex items-center gap-2">
                      {group.map((arg) => (
                        <div key={arg.name} className="flex-1 min-w-0">
                          <ArgInput
                            arg={arg}
                            value={values[arg.name] ?? ""}
                            focused={focusedArg === arg.name}
                            onChange={(v) => setValue(arg.name, v)}
                            onFocusChange={(f) =>
                              setFocusedArg(f ? arg.name : null)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ArgInput
                      arg={head}
                      value={values[head.name] ?? ""}
                      focused={focusedArg === head.name}
                      onChange={(v) => setValue(head.name, v)}
                      onFocusChange={(f) => setFocusedArg(f ? head.name : null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!hidePreview && (
          <PreviewBlock
            fn={fn}
            preview={preview}
            missingRequired={missingRequired}
            onClose={onClose}
          />
        )}

        <div className="px-4 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[5px] font-sans text-[0.857rem] text-muted border border-border bg-transparent hover:bg-subtle cursor-pointer outline-none transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={missingRequired}
            title={
              missingRequired ? "Fill required fields to continue" : undefined
            }
            className="px-3 py-1.5 rounded-[5px] font-sans text-[0.857rem] font-medium border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer outline-none transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
