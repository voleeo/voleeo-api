import { useEffect } from "react"
import type { TreeNode } from "@/store/requests"
import { useSnapshotsStore } from "@/store/snapshots"
import { useTreeUiStore } from "@/store/treeUi"
import { getId } from "./treeUtils"

/** After any tree mutation (deletes, moves) drop ids that no longer exist from
 * the selection/focus/anchor — otherwise a second Delete hands phantom ids off
 * and arrow nav starts from a missing focused id. Saved snapshots are selectable
 * too, so their ids count as alive. */
export function usePruneSelection(tree: TreeNode[]) {
  const snapshotsByRequest = useSnapshotsStore((s) => s.byRequest)
  useEffect(() => {
    const alive = new Set<string>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        alive.add(getId(n))
        if (n.kind === "folder") walk(n.children)
      }
    }
    walk(tree)
    for (const list of Object.values(snapshotsByRequest)) {
      for (const p of list) alive.add(p.id)
    }

    const s = useTreeUiStore.getState()
    const prunedSelected = s.selectedIds.filter((id) => alive.has(id))
    const focusedStale = s.focusedNodeId !== null && !alive.has(s.focusedNodeId)
    const anchorStale =
      s.selectionAnchorId !== null && !alive.has(s.selectionAnchorId)
    if (
      prunedSelected.length === s.selectedIds.length &&
      !focusedStale &&
      !anchorStale
    ) {
      return
    }
    useTreeUiStore.setState({
      selectedIds: prunedSelected,
      focusedNodeId: focusedStale ? null : s.focusedNodeId,
      selectionAnchorId: anchorStale ? null : s.selectionAnchorId,
    })
  }, [tree, snapshotsByRequest])
}
