import type { ExportFolderSelection } from "../../../packages/types/bindings"

export function folderSelectionsFor(
  workspaceIds: Iterable<string>,
  selectedFolderIds: Record<string, string[]>,
): ExportFolderSelection[] {
  const selections: ExportFolderSelection[] = []
  const seen = new Set<string>()
  for (const workspaceId of workspaceIds) {
    for (const folderId of selectedFolderIds[workspaceId] ?? []) {
      const key = `${workspaceId}:${folderId}`
      if (!seen.has(key)) {
        seen.add(key)
        selections.push({ workspaceId, folderId })
      }
    }
  }
  return selections
}

export function sameFolderSelections(
  left: ExportFolderSelection[],
  right: ExportFolderSelection[],
): boolean {
  const key = (selection: ExportFolderSelection) =>
    `${selection.workspaceId}:${selection.folderId}`
  return left.map(key).sort().join("\0") === right.map(key).sort().join("\0")
}
