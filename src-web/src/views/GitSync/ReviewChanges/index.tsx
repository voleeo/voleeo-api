import { useMemo, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { buildReview } from "@/lib/gitEntityDiff"
import { useGitStore } from "@/store/git"
import { useRequestStore } from "@/store/requests"
import { PaneSeparator } from "@/views/ApiWorkspace/PaneSeparator"
import { History } from "../History"
import { RV } from "../reviewClasses"
import { useSidebarResize } from "../useSidebarResize"
import { ChangeDetail } from "./ChangeDetail"
import { ChangesSidebar } from "./ChangesSidebar"
import { PublishBox } from "./PublishBox"

export function ReviewChanges() {
  const changes = useGitStore((s) => s.changes)
  const showHistory = useGitStore((s) => s.showHistory)
  const folders = useRequestStore((s) => s.folders)
  const wsId = useGitStore((s) => s.loadedWorkspaceId) ?? "default"
  const { width, onSepDown } = useSidebarResize(wsId)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<"summary" | "diff">("summary")

  const review = useMemo(
    () =>
      buildReview(
        changes,
        folders.map((f) => ({ id: f.id, name: f.name })),
      ),
    [changes, folders],
  )
  const selected =
    review.find((e) => e.path === selectedPath) ?? review[0] ?? null
  const selectedPaths = review
    .map((e) => e.path)
    .filter((p) => !deselected.has(p))

  const toggleCheck = (path: string) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const allChecked =
    review.length > 0 && review.every((e) => !deselected.has(e.path))
  const toggleAll = () =>
    setDeselected(allChecked ? new Set(review.map((e) => e.path)) : new Set())

  return showHistory ? (
    <History />
  ) : (
    <div className={RV.body}>
      <aside className={RV.side} style={{ width }}>
        <ChangesSidebar
          review={review}
          selectedPath={selected?.path ?? null}
          onSelect={setSelectedPath}
          isChecked={(p) => !deselected.has(p)}
          onToggleCheck={toggleCheck}
        />
        {review.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-2 border-t border-border py-2.5">
            <Checkbox
              className={RV.rowCheck}
              checked={allChecked}
              onCheckedChange={toggleAll}
            />
            <button
              type="button"
              onClick={toggleAll}
              className="font-sans text-[0.8rem] text-muted hover:text-fg bg-transparent border-0 cursor-pointer p-0"
            >
              {allChecked ? "Deselect all" : "Select all"}
            </button>
          </div>
        )}
        <PublishBox count={review.length} selectedPaths={selectedPaths} />
      </aside>
      <PaneSeparator dir="col" onMouseDown={onSepDown} />
      <section className={RV.detail}>
        <ChangeDetail
          entity={selected}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </section>
    </div>
  )
}
