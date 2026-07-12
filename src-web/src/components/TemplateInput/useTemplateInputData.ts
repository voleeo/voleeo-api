import { useCallback, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { inheritedFolderVars } from "@/lib/folderChain"
import { useTemplateFunctions } from "@/plugins/hooks"
import type { BoundTemplateFunction } from "@/plugins/types"
import {
  type EnvironmentVariable,
  useEnvironmentStore,
} from "@/store/environment"
import type { ApiFolder } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { useFolderScope } from "./folderScope"

// Stable empty ref so inputs with no folder scope (cookies, env modal) don't
// re-render when folders change — only folder-scoped inputs subscribe for real.
const NO_FOLDERS: ApiFolder[] = []

/** `system: true` marks allowlisted OS env vars (badged in autocomplete). */
export type ActiveVar = EnvironmentVariable & { system?: boolean }

export interface TemplateInputData {
  activeVars: ActiveVar[]
  fns: BoundTemplateFunction[]
  isEncryptionEnabled: boolean
  activeWorkspaceId: string | null
  varStatus: (name: string) => "found" | "missing" | "system"
  funcStatus: (name: string) => "ok" | "error"
}

export function useTemplateInputData(): TemplateInputData {
  const { environments, activeEnvId, systemEnvVars } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
      systemEnvVars: s.systemEnvVars,
    })),
  )
  // Inherited folder variables are scoped via context (FolderScopeProvider) so
  // every template input under a request/folder editor sees them automatically.
  const folderId = useFolderScope()
  const folders = useRequestStore((s) => (folderId ? s.folders : NO_FOLDERS))

  // Folder vars (nearest→root) win over personal > global > system.
  const activeVars = useMemo<ActiveVar[]>(() => {
    const globalVars =
      environments
        .find((e) => e.kind === "global")
        ?.variables.filter((v) => v.enabled) ?? []
    const personalVars =
      environments
        .find((e) => e.id === activeEnvId)
        ?.variables.filter((v) => v.enabled) ?? []
    const personalKeys = new Set(personalVars.map((v) => v.key))
    const envVars = [
      ...personalVars,
      ...globalVars.filter((v) => !personalKeys.has(v.key)),
    ]
    const envKeys = new Set(envVars.map((v) => v.key))
    const withSystem = [
      ...envVars,
      ...systemEnvVars
        .filter((v) => !envKeys.has(v.key))
        .map((v) => ({ ...v, system: true })),
    ]
    return folderId
      ? [...inheritedFolderVars(folderId, folders), ...withSystem]
      : withSystem
  }, [environments, activeEnvId, systemEnvVars, folderId, folders])

  const fns = useTemplateFunctions()

  const { isEncryptionEnabled, activeWorkspaceId } = useUiStore(
    useShallow((s) => {
      const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
      return {
        isEncryptionEnabled: ws?.encrypted ?? false,
        activeWorkspaceId: s.activeWorkspaceId,
      }
    }),
  )

  const varStatus = useCallback(
    (name: string): "found" | "missing" | "system" => {
      const match = activeVars.find((v) => v.key === name)
      if (!match) return "missing"
      return match.system ? "system" : "found"
    },
    [activeVars],
  )

  const funcStatus = useCallback(
    (name: string): "ok" | "error" =>
      name === "encrypt" && !isEncryptionEnabled ? "error" : "ok",
    [isEncryptionEnabled],
  )

  return {
    activeVars,
    fns,
    isEncryptionEnabled,
    activeWorkspaceId,
    varStatus,
    funcStatus,
  }
}
