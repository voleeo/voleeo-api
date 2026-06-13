import { isAuthEnabled } from "@/lib/authSchemes"
import { ancestorChainRootFirst, inheritedFolderVars } from "@/lib/folderChain"
import type { EnvironmentVariable } from "@/store/environment"
import type { ApiFolder, AuthConfig, HttpRequest } from "@/store/requests"
import type { Workspace } from "@/store/workspace"
import type { RequestParameter } from "../../../../../packages/types/bindings"
import type { AnnotatedHeader } from "./types"

export function mergeInheritedVariables(
  request: HttpRequest,
  folders: ApiFolder[],
  envVars: EnvironmentVariable[],
): EnvironmentVariable[] {
  return [...inheritedFolderVars(request.folderId, folders), ...envVars]
}

export function mergeInheritedHeadersAnnotated(
  request: HttpRequest,
  folders: ApiFolder[],
  workspace: Workspace,
): AnnotatedHeader[] {
  const chain = ancestorChainRootFirst(request.folderId, folders)
  const merged = new Map<string, AnnotatedHeader>()
  const pushAll = (
    rows: RequestParameter[],
    from: AnnotatedHeader["origin"],
    folderName?: string,
  ) => {
    for (const h of rows) {
      if (!h.enabled || !h.name.trim()) continue
      merged.set(h.name.toLowerCase(), { row: h, origin: from, folderName })
    }
  }
  pushAll(workspace.headers ?? [], "workspace")
  for (const f of chain) pushAll(f.headers ?? [], "folder", f.name)
  pushAll(request.headers ?? [], "request")
  return Array.from(merged.values())
}

export interface InheritableAuthSource {
  folderId?: string | null
  auth?: AuthConfig
}

export function resolveInheritedAuth(
  source: InheritableAuthSource,
  folders: ApiFolder[],
  workspace: Workspace,
): AuthConfig {
  return resolveInheritedAuthAnnotated(source, folders, workspace).auth
}

interface ResolvedAuth {
  auth: AuthConfig
  inheritedFromFolderId?: string
  inheritedFromFolderName?: string
  inheritedFromWorkspace?: boolean
}

export function resolveInheritedAuthAnnotated(
  source: InheritableAuthSource,
  folders: ApiFolder[],
  workspace: Workspace,
): ResolvedAuth {
  const auth = source.auth ?? { kind: "none" }
  if (auth.kind !== "inherit") {
    return { auth: isAuthEnabled(auth) ? auth : { kind: "none" } }
  }

  const folderAuth = (): ResolvedAuth | null => {
    const chain = ancestorChainRootFirst(source.folderId ?? null, folders)
    for (let i = chain.length - 1; i >= 0; i--) {
      const f = chain[i]
      const fa = f.auth
      if (
        fa &&
        fa.kind !== "none" &&
        fa.kind !== "inherit" &&
        isAuthEnabled(fa)
      ) {
        return {
          auth: fa,
          inheritedFromFolderId: f.id,
          inheritedFromFolderName: f.name,
        }
      }
    }
    return null
  }
  const workspaceAuth = (): ResolvedAuth | null => {
    const wa = workspace.auth
    return wa &&
      wa.kind !== "none" &&
      wa.kind !== "inherit" &&
      isAuthEnabled(wa)
      ? { auth: wa, inheritedFromWorkspace: true }
      : null
  }

  const preferWorkspace = (auth.from ?? "folder") === "workspace"
  const primary = preferWorkspace ? workspaceAuth() : folderAuth()
  const secondary = preferWorkspace ? folderAuth() : workspaceAuth()
  return primary ?? secondary ?? { auth: { kind: "none" } }
}

export function mergeEnvVars(
  globalVars: EnvironmentVariable[],
  personalVars: EnvironmentVariable[],
): EnvironmentVariable[] {
  const personalKeys = new Set(personalVars.map((v) => v.key))
  return [
    ...personalVars,
    ...globalVars.filter((v) => !personalKeys.has(v.key)),
  ]
}
