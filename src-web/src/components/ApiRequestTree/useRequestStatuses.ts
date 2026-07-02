import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useResponseSummaries } from "@/hooks/useResponseSummaries"
import { useHttpStore } from "@/store/http"
import type { TreeNode } from "@/store/requests"

function collectRequestIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  for (const n of nodes) {
    if (n.kind === "request") ids.push(n.request.id)
    else if (n.kind === "folder") ids.push(...collectRequestIds(n.children))
  }
  return ids
}

export function useRequestStatuses(
  workspaceId: string,
  tree: TreeNode[],
): Record<string, number> {
  const ids = useMemo(() => collectRequestIds(tree), [tree])
  const summaries = useResponseSummaries(workspaceId, ids)

  // Merge with live in-session responses (live takes priority).
  const liveStatuses = useHttpStore(
    useShallow((s) => {
      const out: Record<string, number> = {}
      for (const [id, r] of Object.entries(s.responses)) out[id] = r.status
      return out
    }),
  )
  return useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, s] of Object.entries(summaries)) out[id] = s.status
    return { ...out, ...liveStatuses }
  }, [summaries, liveStatuses])
}
