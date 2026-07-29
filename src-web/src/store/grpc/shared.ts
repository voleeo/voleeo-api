import { ancestorChainRootFirst } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { resolveInheritedAuth } from "@/views/ApiWorkspace/sendResolution/inheritance"
import type {
  ApiFolder,
  AuthConfig,
  GrpcRequest,
  RequestParameter,
} from "../../../../packages/types/bindings"

export function activeEnvId(): string | null {
  return useEnvironmentStore.getState().activeEnvId
}

/** Resolve `Inherit` auth to pass as override (mirrors the WS store). */
export function authOverrideFor(
  workspaceId: string,
  id: string,
): AuthConfig | null {
  const request = useRequestStore
    .getState()
    .grpcRequests.find((g) => g.id === id)
  if (!request || request.auth?.kind !== "inherit") return null
  const workspace = useUiStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return null
  const folders = useRequestStore.getState().folders
  return resolveInheritedAuth(request, folders, workspace)
}

/** Own → nearest folder → root → workspace; first name wins (case-insensitive).
 *  Mirrors Rust `merge_inherited_metadata`. */
function mergeInheritedMetadata(
  own: RequestParameter[],
  folderId: string | null | undefined,
  folders: ApiFolder[],
  workspaceHeaders: RequestParameter[],
): RequestParameter[] {
  const out: RequestParameter[] = []
  const seen = new Set<string>()
  const add = (rows?: RequestParameter[]) => {
    for (const r of rows ?? []) {
      if (!r.enabled || !r.name.trim()) continue
      const key = r.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  add(own)
  const chain = ancestorChainRootFirst(folderId ?? null, folders)
  for (let i = chain.length - 1; i >= 0; i--) add(chain[i].headers)
  add(workspaceHeaders)
  return out
}

/** Resolve Inherit auth + merge folder/workspace headers into metadata (copy-as). */
export function withInheritedGrpcData(request: GrpcRequest): GrpcRequest {
  const { folders } = useRequestStore.getState()
  const { workspaces, activeWorkspaceId } = useUiStore.getState()
  const workspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ??
    workspaces.find((w) => w.id === request.workspaceId)
  if (!workspace) return request

  const auth = resolveInheritedAuth(request, folders, workspace)
  const metadata = mergeInheritedMetadata(
    request.metadata ?? [],
    request.folderId,
    folders,
    workspace.headers ?? [],
  )
  return { ...request, auth, metadata }
}
