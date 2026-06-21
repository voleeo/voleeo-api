import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"

interface LocationSectionProps {
  workspaceId: string
  syncDir: string | null
  onChanged: (ws: Workspace) => void
}

export function LocationSection({
  workspaceId,
  syncDir,
  onChanged,
}: LocationSectionProps) {
  const [saving, setSaving] = useState(false)
  const [defaultPath, setDefaultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: syncDir is a prop — biome misclassifies it as outer scope; re-fetch when it changes
  useEffect(() => {
    commands.workspaceGetPath(workspaceId).then((res) => {
      if (res.status === "ok") setDefaultPath(res.data)
    })
  }, [workspaceId, syncDir])

  const isCustom = syncDir !== null
  const displayPath = syncDir ?? defaultPath

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false })
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const dir = typeof selected === "string" ? selected : selected[0]
      const res = await commands.workspaceSetSyncDir(workspaceId, dir)
      if (res.status === "ok") onChanged(res.data)
      else setError(errorMessage(res.error))
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefault() {
    setSaving(true)
    try {
      const res = await commands.workspaceSetSyncDir(workspaceId, null)
      if (res.status === "ok") onChanged(res.data)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border border-border rounded-[8px] bg-bg px-4 py-3">
        <Glyph
          kind="folder"
          size={15}
          color={isCustom ? "var(--base05)" : "var(--base04)"}
        />
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span
            className={cn(
              "font-mono text-[0.786rem] truncate",
              isCustom ? "text-fg" : "text-muted",
            )}
            title={displayPath ?? undefined}
          >
            {displayPath ?? "Loading…"}
          </span>
          <span className="font-sans text-[0.75rem] text-muted truncate">
            {isCustom
              ? "Custom folder — handy for Git or syncing across devices."
              : "Default location — managed by Voleeo."}
          </span>
        </div>

        {saving ? (
          <Spinner className="size-3.5 text-muted shrink-0" />
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={pickFolder}
              className="px-3 py-1.5 rounded-[5px] font-sans text-[0.786rem] font-medium text-fg cursor-pointer hover:bg-subtle bg-transparent border border-border outline-none transition-colors"
            >
              {isCustom ? "Change…" : "Set folder…"}
            </button>
            {isCustom && (
              <button
                type="button"
                onClick={resetToDefault}
                title="Reset to default location"
                className="p-1.5 rounded-[5px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none transition-colors"
              >
                <Glyph kind="x" size={13} color="var(--base04)" />
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-1.5 leading-relaxed">
          {error}
        </div>
      )}
    </div>
  )
}
