import { Glyph } from "@/components/Glyph"
import { useSnapshotsStore } from "@/store/snapshots"

export function SaveSnapshotButton({
  workspaceId,
  requestId,
  responseId,
}: {
  workspaceId: string
  requestId: string
  responseId: string | null | undefined
}) {
  if (!responseId) return null
  return (
    <button
      type="button"
      title="Save snapshot"
      aria-label="Save snapshot"
      onClick={() =>
        useSnapshotsStore
          .getState()
          .saveSnapshot(workspaceId, requestId, responseId)
      }
      className="flex items-center justify-center size-6 rounded-[6px] cursor-pointer transition-colors border text-muted hover:text-fg bg-transparent border-transparent"
    >
      <Glyph kind="save" size={13} color="currentColor" />
    </button>
  )
}
