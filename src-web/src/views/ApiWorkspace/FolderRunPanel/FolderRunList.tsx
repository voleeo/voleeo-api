import { useMemo } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { useResponseSummaries } from "@/hooks/useResponseSummaries"
import { useFolderRunStore } from "@/store/folderRun"
import { useHttpStore } from "@/store/http"
import type { HttpRequest } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { FolderRunRow } from "./FolderRunRow"
import type { FolderPathSegment } from "./useStoredSend"

export function FolderRunList({
  ordered,
  folderPaths,
}: {
  ordered: HttpRequest[]
  folderPaths: Map<string, FolderPathSegment[]>
}) {
  const included = useFolderRunStore((s) => s.included)
  const reqStatus = useFolderRunStore((s) => s.reqStatus)
  const toggleIncluded = useFolderRunStore((s) => s.toggleIncluded)
  const setAll = useFolderRunStore((s) => s.setAll)
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)

  const ids = useMemo(() => ordered.map((r) => r.id), [ordered])

  const summaries = useResponseSummaries(workspaceId, ids)

  const liveMax = useHttpStore((s) =>
    ordered.reduce(
      (m, r) => Math.max(m, s.responses[r.id]?.timing?.totalMs ?? 0),
      0,
    ),
  )
  const maxTotalMs = useMemo(() => {
    const stored = Object.values(summaries).reduce(
      (m, x) => Math.max(m, x.totalMs),
      0,
    )
    return Math.max(liveMax, stored)
  }, [liveMax, summaries])

  const checkedCount = ordered.filter((r) => included[r.id] !== false).length
  const allChecked = checkedCount === ordered.length && ordered.length > 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-3.5 h-[33px] border-b border-border shrink-0 bg-accent/[0.035]">
        <Checkbox
          checked={allChecked}
          onCheckedChange={() => setAll(!allChecked, ids)}
        />
        <span className="font-sans text-[0.714rem] uppercase tracking-[1.4px] text-muted/70 font-semibold">
          Requests
        </span>
        <span className="font-mono text-[0.714rem] text-muted/70">
          {checkedCount}/{ordered.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {ordered.map((request) => (
          <FolderRunRow
            key={request.id}
            request={request}
            included={included[request.id] !== false}
            runState={reqStatus[request.id]}
            maxTotalMs={maxTotalMs}
            lastSummary={summaries[request.id] ?? null}
            folderPath={
              request.folderId ? folderPaths.get(request.folderId) : undefined
            }
            onToggle={toggleIncluded}
          />
        ))}
      </div>
    </div>
  )
}
