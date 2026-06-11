import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { resolveInheritedAuth } from "@/views/ApiWorkspace/sendResolution/inheritance"
import type { AuthConfig } from "../../../../packages/types/bindings"

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
