import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { buildConflictEntities, type Choice } from "@/lib/gitEntityDiff"
import { useGitStore } from "@/store/git"
import {
  closeIfNothingLeft,
  finishMerge,
  resolveEntity,
} from "@/store/gitReview"
import { useRequestStore } from "@/store/requests"
import { PaneSeparator } from "@/views/ApiWorkspace/PaneSeparator"
import type { ViewMode } from "../diffMode"
import { useSidebarResize } from "../useSidebarResize"
import { ConflictDetail } from "./ConflictDetail"
import { ConflictSidebar } from "./ConflictSidebar"

export type ChoiceMap = Record<string, Choice>
export const choiceKey = (path: string, fieldId: string) =>
  `${path}::${fieldId}`

export function ResolveConflicts() {
  const rawConflicts = useGitStore((s) => s.entityConflicts)
  const folders = useRequestStore((s) => s.folders)
  const op = useGitStore((s) => s.op)
  const wsId = useGitStore((s) => s.loadedWorkspaceId) ?? "default"
  const { width, onSepDown } = useSidebarResize(wsId)
  const hasAuthor = useGitStore((s) => s.repo?.hasAuthor ?? true)
  const storeError = useGitStore((s) => s.error)
  const [choices, setChoices] = useState<ChoiceMap>({})
  const [selPath, setSelPath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("summary")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const conflicts = useMemo(
    () =>
      buildConflictEntities(
        rawConflicts,
        folders.map((f) => ({ id: f.id, name: f.name })),
      ),
    [rawConflicts, folders],
  )
  // Git flags whole files; we re-derive conflicts per field. An entity where each
  // side touched *different* fields merges unambiguously, so it needs no user
  // choice — only surface the ones that do. The rest are auto-merged on save.
  const pending = useMemo(
    () => conflicts.filter((c) => c.conflicts.length > 0),
    [conflicts],
  )
  const selected = pending.find((c) => c.path === selPath) ?? pending[0] ?? null

  const total = pending.reduce((n, e) => n + e.conflicts.length, 0)
  const resolved = pending.reduce(
    (n, e) =>
      n + e.conflicts.filter((f) => choices[choiceKey(e.path, f.id)]).length,
    0,
  )
  const allDone = resolved === total
  const left = total - resolved
  const identityReady = hasAuthor || (name.trim() !== "" && email.trim() !== "")
  const displayError = error ?? storeError

  // Resizable Your/Their split: a CSS var drives the column ratio for both the
  // sticky header and every field's pair. The handle lives in the (non-scrolling)
  // detail section so it stays full-height while the body scrolls.
  const detailRef = useRef<HTMLDivElement>(null)
  const [colPct, setColPct] = useState(50)
  const onColDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = detailRef.current
    if (!el) return
    const PAD = 18 // cf-detail-body horizontal padding
    const MIN_PX = 220 // keep each pane wide enough for its header + button
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const inner = r.width - PAD * 2
      if (inner <= 0) return
      const minPct = (MIN_PX / inner) * 100
      const pct = ((ev.clientX - r.left - PAD) / inner) * 100
      setColPct(Math.min(100 - minPct, Math.max(minPct, pct)))
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }, [])

  const pick = (path: string, id: string, choice: Choice) =>
    setChoices((c) => ({ ...c, [choiceKey(path, id)]: choice }))

  const keepAll = (which: Choice) =>
    setChoices(() => {
      const m: ChoiceMap = {}
      for (const e of pending)
        for (const f of e.conflicts) m[choiceKey(e.path, f.id)] = which
      return m
    })

  const publishMerged = useCallback(async () => {
    if (!allDone || op || !identityReady) return
    setError(null)
    try {
      for (const e of conflicts) {
        const entChoice: ChoiceMap = {}
        for (const f of e.conflicts)
          entChoice[f.id] = choices[choiceKey(e.path, f.id)]
        await resolveEntity(e, entChoice)
      }
      await finishMerge(
        "Merge remote changes",
        hasAuthor ? undefined : { name: name.trim(), email: email.trim() },
      )
      await closeIfNothingLeft()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [allDone, op, identityReady, conflicts, choices, hasAuthor, name, email])

  // Nothing for the user to choose (every conflict auto-merges) and an identity
  // is already configured → just finish the merge instead of parking on a button.
  // Guarded so it fires once; only after conflicts have loaded (length > 0).
  const autoFinished = useRef(false)
  useEffect(() => {
    if (autoFinished.current || op) return
    if (conflicts.length === 0 || pending.length > 0 || !hasAuthor) return
    autoFinished.current = true
    void publishMerged()
  }, [conflicts.length, pending.length, hasAuthor, op, publishMerged])

  return (
    <div className="flex-1 min-h-0 flex">
      <aside
        className="shrink-0 flex flex-col border-r border-border min-h-0"
        style={{ width }}
      >
        <ConflictSidebar
          conflicts={pending}
          choices={choices}
          selectedPath={selected?.path ?? null}
          onSelect={setSelPath}
        />
        <div className="shrink-0 px-4 py-3.5 border-t border-border">
          {!hasAuthor && (
            <div className="mb-2 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
          {displayError && (
            <div className="mb-2 text-[0.78rem] text-error">{displayError}</div>
          )}
          <Button
            className="w-full"
            disabled={!allDone || !!op || !identityReady}
            onClick={publishMerged}
          >
            {op === "merge"
              ? "Saving…"
              : allDone
                ? "Save merged version"
                : `${left} conflict${left === 1 ? "" : "s"} left`}
          </Button>
        </div>
      </aside>
      <PaneSeparator dir="col" onMouseDown={onSepDown} />
      <section
        ref={detailRef}
        className="flex-1 min-w-0 relative flex flex-col"
        style={
          {
            "--cf-cols": `${colPct}fr ${100 - colPct}fr`,
            "--cf-split": colPct / 100,
          } as React.CSSProperties
        }
      >
        {selected ? (
          <ConflictDetail
            entity={selected}
            choices={choices}
            onPick={pick}
            onKeepAll={keepAll}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        ) : (
          <div className="flex-1 grid place-items-center px-8 text-center text-[0.893rem] text-[var(--fg-faint)]">
            {conflicts.length > 0
              ? "All changes merge cleanly — click “Save merged version” to finish."
              : "Nothing left to resolve."}
          </div>
        )}

        {selected && viewMode === "summary" && (
          <div
            className="absolute top-0 bottom-0 w-[11px] z-[3] cursor-col-resize -translate-x-1/2 before:content-[''] before:absolute before:left-1/2 before:top-0 before:bottom-0 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors hover:before:w-0.5 hover:before:bg-accent"
            style={{
              left: "calc(18px + (100% - 36px) * var(--cf-split, 0.5))",
            }}
            onMouseDown={onColDown}
            role="separator"
            aria-orientation="vertical"
          />
        )}
      </section>
    </div>
  )
}
