import { useCallback, useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { getCachedSettings, patchSettings } from "@/lib/workspaceSettings"
import { useEnvironmentStore } from "@/store/environment"
import { commands } from "../../../../../packages/types/bindings"
import { AddVarDropdown } from "./AddVarDropdown"
import { SystemEnvRow } from "./SystemEnvRow"

export function SystemEnvBlock({
  workspaceId,
  flashKey,
  flashNonce,
}: {
  workspaceId: string
  flashKey?: string
  flashNonce?: number
}) {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<Record<string, string> | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [allowlist, setAllowlist] = useState<string[]>(
    () => getCachedSettings(workspaceId).systemEnvAllowlist ?? [],
  )
  const [pickerPos, setPickerPos] = useState<{
    top: number
    right: number
  } | null>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    commands
      .systemEnvList()
      .then((res) => {
        if (cancelled) return
        if (res.status === "ok") setSnapshot(res.data)
        else setSnapshotError(errorMessage(res.error))
      })
      .catch((e) => {
        if (!cancelled) setSnapshotError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Expand so the flashed row is visible when navigated to via a chip click.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flashNonce re-fires the expand on repeat clicks
  useEffect(() => {
    if (flashKey) setOpen(true)
  }, [flashKey, flashNonce])

  const save = useCallback(
    (list: string[]) => {
      setAllowlist(list)
      patchSettings(workspaceId, {
        systemEnvAllowlist: list.length > 0 ? list : null,
      })
      void useEnvironmentStore.getState().refreshSystemEnv(workspaceId)
    },
    [workspaceId],
  )

  const openPicker = useCallback(() => {
    setOpen(true)
    if (!snapshot) return
    const rect = addBtnRef.current?.getBoundingClientRect()
    if (!rect) return
    setPickerPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
  }, [snapshot])

  const addVar = useCallback(
    (name: string) => save([...allowlist, name]),
    [allowlist, save],
  )
  const removeVar = useCallback(
    (name: string) => save(allowlist.filter((k) => k !== name)),
    [allowlist, save],
  )

  return (
    <div className="border border-border rounded-[5px] overflow-hidden shrink-0">
      <div className="flex items-center bg-surface">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 px-2.5 py-2 hover:bg-subtle cursor-pointer border-0 outline-none text-left bg-transparent transition-colors"
        >
          <span
            className="inline-flex shrink-0 transition-transform duration-100"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
          >
            <Glyph kind="chevron" size={12} color="var(--base04)" />
          </span>
          <span className="font-sans text-[0.714rem] uppercase tracking-[1.2px] text-muted/70 font-semibold">
            System
          </span>
          <span className="font-mono text-[0.714rem] text-muted/60">
            {allowlist.length}
          </span>
          <span className="ml-auto font-sans text-[0.714rem] text-muted/50">
            read-only
          </span>
        </button>
        <button
          ref={addBtnRef}
          type="button"
          onClick={openPicker}
          title="Expose a system environment variable"
          className="flex items-center px-2.5 py-2 border-0 outline-none cursor-pointer bg-transparent text-muted hover:text-fg hover:bg-subtle transition-colors"
        >
          <Glyph kind="plus" size={12} color="currentColor" />
        </button>
      </div>

      {open && (
        <div className="border-t border-border">
          {snapshotError !== null && (
            <div className="px-2.5 py-2 font-sans text-[0.786rem] text-error/80">
              Couldn't read the system environment: {snapshotError}
            </div>
          )}
          {snapshotError === null && allowlist.length === 0 && (
            <div className="px-2.5 py-2 font-sans text-[0.786rem] text-muted/60">
              No system variables exposed — add one with the + button.
            </div>
          )}
          {allowlist.length > 0 &&
            snapshot === null &&
            snapshotError === null && (
              <div className="flex items-center gap-2 px-2.5 py-2">
                <Spinner className="size-3.5 text-muted" />
              </div>
            )}
          {snapshot !== null &&
            allowlist.map((name) => (
              <SystemEnvRow
                key={name}
                name={name}
                value={name in snapshot ? snapshot[name] : null}
                onRemove={removeVar}
                flash={flashKey === name}
                flashNonce={flashNonce}
              />
            ))}
        </div>
      )}

      {pickerPos && snapshot && (
        <AddVarDropdown
          pos={pickerPos}
          candidates={Object.keys(snapshot)
            .filter((k) => !allowlist.includes(k))
            .sort()}
          anchorRef={addBtnRef}
          onAdd={addVar}
          onClose={() => setPickerPos(null)}
        />
      )}
    </div>
  )
}
