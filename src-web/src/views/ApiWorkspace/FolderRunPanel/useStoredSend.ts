import { useShallow } from "zustand/react/shallow"
import {
  clearResponseCycleCache,
  pendingPreflightEvents,
} from "@/builtins/response"
import { isAbortError } from "@/lib/abort"
import { useTemplateFunctions } from "@/plugins/hooks"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { CookieJar } from "@/store/cookies"
import { useCookiesStore } from "@/store/cookies"
import type { EnvironmentVariable } from "@/store/environment"
import { useEnvironmentStore } from "@/store/environment"
import { useHttpStore } from "@/store/http"
import type { ApiFolder, HttpRequest, TreeNode } from "@/store/requests"
import { buildTree, useRequestStore } from "@/store/requests"
import type { Workspace } from "@/store/workspace"
import { useUiStore } from "@/store/workspace"
import { storedPathParams } from "../paramUtils"
import {
  buildSentSnapshot,
  mergeEnvVars,
  resolveSendPayload,
} from "../sendResolution"

/** Every request under `folderId`, recursing into nested subfolders, in tree
 *  order. Reuses `buildTree` so ordering matches the sidebar exactly. */
export function collectDescendantRequests(
  folderId: string,
  folders: ApiFolder[],
  requests: HttpRequest[],
): HttpRequest[] {
  const out: HttpRequest[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "request") out.push(node.request)
      else if (node.kind === "folder") walk(node.children)
    }
  }
  walk(buildTree(folders, requests, [], [], folderId))
  return out
}

export interface FolderPathSegment {
  id: string
  name: string
}

/** Map each folder nested under `rootFolderId` to its `{id, name}` path from
 *  the root (root excluded): root→"A"→"B" yields B's id → [{A}, {B}]. Lets run
 *  rows show and link to the inner folder a request came from. */
export function folderPathsUnder(
  rootFolderId: string,
  folders: ApiFolder[],
): Map<string, FolderPathSegment[]> {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const cache = new Map<string, FolderPathSegment[] | null>()
  const pathFor = (id: string): FolderPathSegment[] | null => {
    if (id === rootFolderId) return []
    if (cache.has(id)) return cache.get(id) ?? null
    const f = byId.get(id)
    const parentId = f?.folderId ?? null
    const parent = parentId ? pathFor(parentId) : null
    const path =
      !f || parent === null ? null : [...parent, { id: f.id, name: f.name }]
    cache.set(id, path)
    return path
  }
  const out = new Map<string, FolderPathSegment[]>()
  for (const f of folders) {
    const path = pathFor(f.id)
    if (path && path.length > 0) out.set(f.id, path)
  }
  return out
}

export interface StoredSendCtx {
  workspaceId: string
  workspace: Workspace
  folders: ApiFolder[]
  vars: EnvironmentVariable[]
  templateFns: BoundTemplateFunction[]
  activeJar: CookieJar | null
  activeEnvId: string | null
}

/** Assemble the send context from the relevant stores — mirrors the inputs
 *  `RequestPane.handleSend` feeds `resolveSendPayload`, minus editor drafts. */
export function useStoredSendCtx(): StoredSendCtx | null {
  const { activeWorkspaceId, workspace } = useUiStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      workspace: s.activeWorkspaceId
        ? (s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null)
        : null,
    })),
  )
  const { environments, activeEnvId, systemEnvVars } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
      systemEnvVars: s.systemEnvVars,
    })),
  )
  const { activeJar, cookiesLoadedWorkspaceId } = useCookiesStore(
    useShallow((s) => ({
      activeJar: s.jars.find((j) => j.id === s.activeJarId) ?? null,
      cookiesLoadedWorkspaceId: s.loadedWorkspaceId,
    })),
  )
  const templateFns = useTemplateFunctions()
  const folders = useRequestStore((s) => s.folders)

  if (!activeWorkspaceId || !workspace) return null

  const vars = mergeEnvVars(
    environments.find((e) => e.kind === "global")?.variables ?? [],
    environments.find((e) => e.id === activeEnvId)?.variables ?? [],
    systemEnvVars,
  )
  return {
    workspaceId: activeWorkspaceId,
    workspace,
    folders,
    vars,
    templateFns,
    activeJar:
      cookiesLoadedWorkspaceId === activeWorkspaceId ? activeJar : null,
    activeEnvId,
  }
}

/** Resolve a stored request through the full send pipeline and fire it via the
 *  http store. Returns "aborted" when an `ask()` prompt was cancelled. */
export async function resolveAndSendStoredRequest(
  request: HttpRequest,
  ctx: StoredSendCtx,
): Promise<"sent" | "aborted"> {
  const { values, enabled } = storedPathParams(request)
  let payload: Awaited<ReturnType<typeof resolveSendPayload>>
  try {
    payload = await resolveSendPayload({
      request,
      urlDraft: request.url,
      pathParamValues: values,
      pathParamEnabled: enabled,
      vars: ctx.vars,
      templateFns: ctx.templateFns,
      folders: ctx.folders,
      workspace: ctx.workspace,
      activeJar: ctx.activeJar,
      forSend: true,
    })
  } catch (e) {
    if (isAbortError(e)) return "aborted"
    throw e
  }

  const preflightEvents = pendingPreflightEvents.splice(0)
  useHttpStore
    .getState()
    .setLastSent(
      request.id,
      buildSentSnapshot({ request, payload, capturedAt: Date.now() }),
    )

  await useHttpStore
    .getState()
    .sendRequest(
      ctx.workspaceId,
      request.id,
      payload.fullUrl !== request.url ? payload.fullUrl : undefined,
      payload.body,
      payload.headers,
      [...preflightEvents, ...payload.resolutionEvents],
      ctx.activeEnvId,
      payload.cookies,
      payload.dynamicAuthOverride,
    )
  return "sent"
}

export { clearResponseCycleCache }
