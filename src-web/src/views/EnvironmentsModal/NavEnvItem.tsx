import { useRef, useState } from "react"
import { ColorPickerPopover } from "@/components/ColorPickerPopover"
import { Glyph } from "@/components/Glyph"
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { cn } from "@/lib/utils"
import type { Environment } from "@/store/environment"
import { useEnvironmentStore } from "@/store/environment"

interface Props {
  env: Environment
  isActive: boolean
  onClick: () => void
  onDeleted: () => void
}

export function NavEnvItem({ env, isActive, onClick, onDeleted }: Props) {
  const update = useEnvironmentStore((s) => s.update)
  const remove = useEnvironmentStore((s) => s.remove)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const isGlobal = env.kind === "global"

  async function handleColorChange(color: string) {
    await update({ ...env, color }).catch(() => {})
  }

  function startRename(e: React.MouseEvent) {
    if (isGlobal) return
    e.stopPropagation()
    setRenameDraft(env.name)
  }

  async function commitRename() {
    const trimmed = renameDraft?.trim()
    setRenameDraft(null)
    if (trimmed && trimmed !== env.name) {
      await update({ ...env, name: trimmed }).catch(() => {})
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setConfirmOpen(true)
  }

  async function handleConfirmDelete() {
    await remove(env.workspaceId, env.id)
    onDeleted()
  }

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = colorBtnRef.current?.getBoundingClientRect()
    setPickerAnchor(rect ?? null)
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2 mx-2 px-2 py-[6px] rounded-md cursor-pointer transition-colors w-[calc(100%-16px)]",
          isActive ? "bg-accent/10" : "bg-transparent hover:bg-subtle",
        )}
        onClick={onClick}
        onKeyDown={(e) => e.key === "Enter" && onClick()}
        role="button"
        tabIndex={0}
      >
        {isGlobal ? (
          <Glyph
            kind="globe"
            size={13}
            color={isActive ? "var(--base0D)" : "var(--base04)"}
          />
        ) : (
          <button
            ref={colorBtnRef}
            type="button"
            onClick={openPicker}
            className="w-3 h-3 rounded-full shrink-0 cursor-pointer border-0 outline-none ring-1 ring-transparent hover:ring-border transition-all"
            style={{ background: env.color }}
            title="Change color"
          />
        )}

        {renameDraft !== null ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") setRenameDraft(null)
            }}
            onBlur={commitRename}
            autoComplete="off"
            spellCheck={false}
            className="font-sans text-[0.929rem] text-fg bg-transparent border-0 outline-none flex-1 min-w-0 select-text"
          />
        ) : (
          <span
            onDoubleClick={startRename}
            className={cn(
              "font-sans text-[0.929rem] truncate flex-1 text-left",
              isActive ? "text-accent" : "text-muted group-hover:text-fg",
            )}
          >
            {env.name}
          </span>
        )}

        {isGlobal ? (
          <Glyph
            kind="lock"
            size={11}
            color="var(--base04)"
            style={{ opacity: 0.4 }}
          />
        ) : (
          <button
            type="button"
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center w-4 h-4 rounded-[3px] border-0 outline-none cursor-pointer bg-transparent shrink-0 transition-opacity"
            title="Delete environment"
          >
            <Glyph kind="trash" size={12} color="var(--base08)" />
          </button>
        )}
      </div>

      {pickerAnchor && (
        <ColorPickerPopover
          color={env.color}
          anchorRect={pickerAnchor}
          onChange={handleColorChange}
          onClose={() => setPickerAnchor(null)}
        />
      )}

      {confirmOpen && (
        <ConfirmationDialog
          title="Delete Environment"
          icon="warning"
          description={
            <>
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold">"{env.name}"</span>?
            </>
          }
          warningText="All variables in this environment will be lost."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirmDelete}
          confirmLabel="Delete"
          confirmVariant="destructive"
        />
      )}
    </>
  )
}
