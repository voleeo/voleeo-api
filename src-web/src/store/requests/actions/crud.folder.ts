import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import { type GetState, type SetState, syncOnFailure } from "./shared"

/** Create / duplicate / rename / delete for folders. */
export function folderCrudActions(set: SetState, get: GetState) {
  return {
    createFolder: async (
      workspaceId: string,
      opts: { folderId?: string; name?: string } = {},
    ) => {
      const res = await commands.createFolder(
        workspaceId,
        opts.folderId ?? null,
        opts.name ?? "New Folder",
      )
      if (res.status !== "ok") return null
      const folder = res.data
      set((s) => {
        const folders = [...s.folders, folder]
        return {
          folders,
          tree: buildTree(folders, s.requests, s.connections, s.grpcRequests),
        }
      })
      return folder
    },

    duplicateFolder: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateFolder(workspaceId, id)
      if (res.status !== "ok") return null
      await get().reload()
      return res.data
    },

    renameFolder: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const folders = s.folders.map((f) => (f.id === id ? { ...f, name } : f))
        return {
          folders,
          tree: buildTree(folders, s.requests, s.connections, s.grpcRequests),
        }
      })
      const res = await commands.renameFolder(workspaceId, id, name)
      await syncOnFailure(get, res, "rename folder")
    },

    deleteFolder: async (workspaceId: string, id: string) => {
      set((s) => {
        const allFolderIds = new Set<string>()
        const queue = [id]
        while (queue.length > 0) {
          const fid = queue.pop()
          if (!fid) break
          allFolderIds.add(fid)
          for (const f of s.folders.filter((f) => f.folderId === fid)) {
            queue.push(f.id)
          }
        }
        const folders = s.folders.filter((f) => !allFolderIds.has(f.id))
        const requests = s.requests.filter(
          (r) => !allFolderIds.has(r.folderId ?? ""),
        )
        const connections = s.connections.filter(
          (c) => !allFolderIds.has(c.folderId ?? ""),
        )
        const activeInDeleted =
          !!s.activeRequestId &&
          allFolderIds.has(
            s.requests.find((r) => r.id === s.activeRequestId)?.folderId ?? "",
          )
        let nextActiveId = s.activeRequestId
        if (activeInDeleted) {
          const oldIdx = s.requests.findIndex((r) => r.id === s.activeRequestId)
          nextActiveId =
            (requests[oldIdx] ?? requests[oldIdx - 1] ?? null)?.id ?? null
        }
        const nextActiveFolderId =
          s.activeFolderId && allFolderIds.has(s.activeFolderId)
            ? null
            : s.activeFolderId
        const connActiveInDeleted =
          !!s.activeConnectionId &&
          allFolderIds.has(
            s.connections.find((c) => c.id === s.activeConnectionId)
              ?.folderId ?? "",
          )
        return {
          folders,
          requests,
          connections,
          tree: buildTree(folders, requests, connections, s.grpcRequests),
          activeRequestId: nextActiveId,
          activeFolderId: nextActiveFolderId,
          activeConnectionId: connActiveInDeleted ? null : s.activeConnectionId,
        }
      })
      const res = await commands.deleteFolder(workspaceId, id)
      await syncOnFailure(get, res, "delete folder")
    },
  }
}
