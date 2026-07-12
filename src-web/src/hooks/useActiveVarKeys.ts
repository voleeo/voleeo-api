import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import type { VarSuggestion } from "@/components/TemplateInput/Autocomplete"
import { useFolderScope } from "@/components/TemplateInput/folderScope"
import { inheritedFolderVars } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { type ApiFolder, useRequestStore } from "@/store/requests"

// Stable empty ref so inputs with no folder scope don't subscribe to folders.
const NO_FOLDERS: ApiFolder[] = []

export function useActiveVarKeys(): VarSuggestion[] {
  const { environments, activeEnvId, systemEnvVars } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
      systemEnvVars: s.systemEnvVars,
    })),
  )
  const folderId = useFolderScope()
  const folders = useRequestStore((s) => (folderId ? s.folders : NO_FOLDERS))

  return useMemo(() => {
    const enabled = (
      kindMatch: (e: (typeof environments)[number]) => boolean,
    ) => environments.find(kindMatch)?.variables.filter((v) => v.enabled) ?? []
    const personal = enabled((e) => e.id === activeEnvId)
    const global = enabled((e) => e.kind === "global")
    const personalKeys = new Set(personal.map((v) => v.key))

    const folderVars = folderId ? inheritedFolderVars(folderId, folders) : []
    const seen = new Set<string>()
    const out: VarSuggestion[] = []
    const push = (key: string, system?: boolean) => {
      if (!seen.has(key)) {
        seen.add(key)
        out.push(system ? { name: key, system } : { name: key })
      }
    }
    for (const v of folderVars) push(v.key)
    for (const v of personal) push(v.key)
    for (const v of global) if (!personalKeys.has(v.key)) push(v.key)
    for (const v of systemEnvVars) push(v.key, true)
    return out
  }, [environments, activeEnvId, systemEnvVars, folderId, folders])
}
