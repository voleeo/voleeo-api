import { MANAGED_CONTENT_TYPE } from "@/lib/contentTypes"
import { randomId } from "@/lib/ids"
import type {
  HttpRequest,
  RequestBody,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import { buildTree } from "../buildTree"
import { saveLastRequestId } from "../persistence"
import {
  DEFAULT_REQUEST_NAME,
  type GetState,
  type SetState,
  syncOnFailure,
} from "./shared"

/** Create / duplicate / rename / delete for HTTP requests. */
export function requestCrudActions(set: SetState, get: GetState) {
  return {
    createRequest: async (
      workspaceId: string,
      opts: {
        folderId?: string
        name?: string
        method?: string
        url?: string
        body?: RequestBody | null
        headers?: RequestParameter[]
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
      let req: HttpRequest = res.data
      if (opts.body !== undefined || opts.headers) {
        const headers = opts.headers ?? req.headers ?? []
        const body = opts.body !== undefined ? opts.body : (req.body ?? null)
        await commands.updateRequest(
          workspaceId,
          req.id,
          req.method,
          req.url,
          req.parameters ?? [],
          headers,
          body,
          req.auth ?? { kind: "none" },
        )
        req = { ...req, headers, body }
      }
      saveLastRequestId(workspaceId, req.id)
      set((s) => {
        const requests = [...s.requests, req]
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections, s.grpcRequests),
          activeRequestId: req.id,
          activeFolderId: null,
          activeConnectionId: null,
        }
      })
      return req
    },

    createGraphqlRequest: async (
      workspaceId: string,
      opts: { folderId?: string; name?: string } = {},
    ) =>
      get().createRequest(workspaceId, {
        ...opts,
        method: "POST",
        headers: [
          {
            id: randomId(),
            name: "Content-Type",
            value: MANAGED_CONTENT_TYPE.graphql ?? "application/json",
            enabled: true,
          },
        ],
        body: { kind: "graphql", text: "" },
      }),

    duplicateRequest: async (workspaceId: string, id: string) => {
      const res = await commands.duplicateRequest(workspaceId, id)
      if (res.status !== "ok") return null
      set((s) => {
        const requests = [...s.requests, res.data]
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections, s.grpcRequests),
        }
      })
      return res.data
    },

    renameRequest: async (workspaceId: string, id: string, name: string) => {
      set((s) => {
        const requests = s.requests.map((r) =>
          r.id === id ? { ...r, name } : r,
        )
        return {
          requests,
          tree: buildTree(s.folders, requests, s.connections, s.grpcRequests),
        }
      })
      const res = await commands.renameRequest(workspaceId, id, name)
      await syncOnFailure(get, res, "rename request")
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
          tree: buildTree(s.folders, requests, s.connections, s.grpcRequests),
          activeRequestId: nextActiveId,
        }
      })
      const res = await commands.deleteRequest(workspaceId, id)
      await syncOnFailure(get, res, "delete request")
    },
  }
}
