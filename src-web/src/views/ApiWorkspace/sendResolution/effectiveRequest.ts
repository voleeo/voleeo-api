import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import type { HttpRequest } from "../../../../../packages/types/bindings"
import {
  mergeInheritedHeadersAnnotated,
  resolveInheritedAuthAnnotated,
} from "./inheritance"

export function withInheritedData(request: HttpRequest): HttpRequest {
  const { folders } = useRequestStore.getState()
  const { workspaces, activeWorkspaceId } = useUiStore.getState()
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  if (!workspace) return request

  const headers = mergeInheritedHeadersAnnotated(
    request,
    folders,
    workspace,
  ).map((h) => h.row)
  const { auth } = resolveInheritedAuthAnnotated(request, folders, workspace)
  return { ...request, headers, auth }
}
