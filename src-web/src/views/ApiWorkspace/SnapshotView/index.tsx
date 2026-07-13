import { useShallow } from "zustand/react/shallow"
import { Spinner } from "@/components/ui/spinner"
import { useSnapshotsStore } from "@/store/snapshots"
import { RequestSnapshot } from "./RequestSnapshot"

export { SnapshotResponsePane } from "./SnapshotResponsePane"

export function SnapshotView() {
  const { activeSnapshot, replaying } = useSnapshotsStore(
    useShallow((s) => ({
      activeSnapshot: s.activeSnapshot,
      replaying: s.replaying,
    })),
  )

  if (!activeSnapshot) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="size-5 text-fg" aria-hidden />
      </div>
    )
  }

  const replayNow = () => {
    const wsId = useSnapshotsStore.getState().loadedWorkspaceId
    if (wsId && !replaying) {
      useSnapshotsStore.getState().replaySnapshot(wsId, activeSnapshot.id)
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-accent/[0.035]">
      <RequestSnapshot
        snapshotId={activeSnapshot.id}
        request={activeSnapshot.request}
        replaying={replaying}
        onReplay={replayNow}
      />
    </div>
  )
}
