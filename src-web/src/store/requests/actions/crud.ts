import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import { saveLastRequestId } from "../persistence"
import {
  DEFAULT_CONNECTION_NAME,
  DEFAULT_REQUEST_NAME,
  type GetState,
  type SetState,
} from "./shared"

/** Create / duplicate / rename / delete for requests, folders, connections. */
export function crudActions(set: SetState, get: GetState) {
  return {
    createRequest: async (
      workspaceId: string,
      opts: {
        folderId?: string
        name?: string
        method?: string
        url?: string
      } = {},
    ) => {
      const res = await commands.createRequest(
        workspaceId,
        opts.folderId ?? null,
        opts.name ?? DEFAULT_REQUEST_NAME,
        opts.method ?? "GET",
        opts.url ?? "",
      )
      if (res.status !== "ok") return null
      const req = res.data
      saveLastRequestId(workspaceId, req.id)
      set((s) => {
        const requests = [...s.requests, req]
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections),
          activeRequestId: req.id,
          activeFolderId: null,
          activeConnectionId: null,
        }
      })
      return req
    },

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
        return { folders, tree: buildTree(folders, s.requests, s.connections) }
      })
      return folder
    },

    createConnection: async (
      workspaceId: string,
      opts: { folderId?: string; name?: string; url?: string } = {},
    ) => {
      const res = await commands.createWsConnection(
        workspaceId,
        opts.folderId ?? null,
        opts.name ?? DEFAULT_CONNECTION_NAME,
        opts.url ?? "",
      )
      if (res.status !== "ok") return null
      const connection = res.data
      set((s) => {
        const connections = [...s.connections, connection]
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections),
          activeConnectionId: connection.id,
          activeRequestId: null,
          activeFolderId: null,
        }
      })
      return connection
    },

    duplicateRequest: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateRequest(workspaceId, id)
      if (res.status !== "ok") return
      set((s) => {
        const requests = [...s.requests, res.data]
        return { requests, tree: buildTree(s.folders, requests, s.connections) }
      })
    },

    duplicateFolder: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateFolder(workspaceId, id)
      if (res.status !== "ok") return
      await get().reload()
    },

    duplicateConnection: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateWsConnection(workspaceId, id)
      if (res.status !== "ok") return
      set((s) => {
        const connections = [...s.connections, res.data]
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections),
        }
      })
    },

    renameRequest: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const requests = s.requests.map((r) =>
          r.id === id ? { ...r, name } : r,
        )
        return { requests, tree: buildTree(s.folders, requests, s.connections) }
      })
      await commands.renameRequest(workspaceId, id, name)
    },

    renameFolder: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const folders = s.folders.map((f) => (f.id === id ? { ...f, name } : f))
        return { folders, tree: buildTree(folders, s.requests, s.connections) }
      })
      await commands.renameFolder(workspaceId, id, name)
    },

    renameConnection: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const connections = s.connections.map((c) =>
          c.id === id ? { ...c, name } : c,
        )
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections),
        }
      })
      await commands.renameWsConnection(workspaceId, id, name)
    },

    deleteRequest: async (workspaceId: string, id: string) => {
      set((s) => {
        const idx = s.requests.findIndex((r) => r.id === id)
        const requests = s.requests.filter((r) => r.id !== id)
        const nextActiveId =
          s.activeRequestId === id
            ? ((requests[idx] ?? requests[idx - 1] ?? null)?.id ?? null)
            : s.activeRequestId
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections),
          activeRequestId: nextActiveId,
        }
      })
      await commands.deleteRequest(workspaceId, id)
    },

    deleteConnection: async (workspaceId: string, id: string) => {
      set((s) => {
        const connections = s.connections.filter((c) => c.id !== id)
        return {
          connections,
          tree: buildTree(s.folders, s.requests, connections),
          activeConnectionId:
            s.activeConnectionId === id ? null : s.activeConnectionId,
        }
      })
      await commands.deleteWsConnection(workspaceId, id)
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
          tree: buildTree(folders, requests, connections),
          activeRequestId: nextActiveId,
          activeFolderId: nextActiveFolderId,
          activeConnectionId: connActiveInDeleted ? null : s.activeConnectionId,
        }
      })
      await commands.deleteFolder(workspaceId, id)
    },
  }
}
