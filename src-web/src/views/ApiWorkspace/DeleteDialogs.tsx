import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog"
import { useSnapshotsStore } from "@/store/snapshots"
import type { PendingDelete } from "./useTreeActions"

interface Props {
  pendingDelete: PendingDelete | null
  pendingDeleteBatch: string[] | null
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onConfirmBatch: () => void
  onCancelBatch: () => void
}

export function DeleteDialogs({
  pendingDelete,
  pendingDeleteBatch,
  onConfirmDelete,
  onCancelDelete,
  onConfirmBatch,
  onCancelBatch,
}: Props) {
  const snapshotCount = useSnapshotsStore((s) =>
    pendingDelete?.kind === "request"
      ? (s.byRequest[pendingDelete.id]?.length ?? 0)
      : 0,
  )
  return (
    <>
      {pendingDelete && (
        <ConfirmationDialog
          title={
            pendingDelete.kind === "request"
              ? "Delete Request"
              : "Delete Folder"
          }
          description={
            <>
              Permanently delete{" "}
              <code className="font-mono text-[0.857rem] bg-subtle text-fg px-1.5 py-0.5 rounded-[3px]">
                {pendingDelete.name}
              </code>
              ?
            </>
          }
          warningText={
            pendingDelete.kind === "folder"
              ? "Every request and sub-folder inside it will also be permanently deleted."
              : snapshotCount > 0
                ? `This also deletes ${snapshotCount} saved snapshot${snapshotCount === 1 ? "" : "s"} (recoverable from git history if synced).`
                : undefined
          }
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
      {pendingDeleteBatch && (
        <ConfirmationDialog
          title="Delete Items"
          description={
            <>
              Permanently delete{" "}
              <span className="font-semibold text-fg">
                {pendingDeleteBatch.length}{" "}
                {pendingDeleteBatch.length === 1 ? "item" : "items"}
              </span>
              ?
            </>
          }
          warningText="Folders take their requests and sub-folders with them; deleted snapshots stay recoverable from git history if synced."
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={onConfirmBatch}
          onCancel={onCancelBatch}
        />
      )}
    </>
  )
}
