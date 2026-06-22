import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useFolderScope } from "@/components/TemplateInput/folderScope"
import { inheritedFolderVars } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { type ApiFolder, useRequestStore } from "@/store/requests"

// Stable empty ref so inputs with no folder scope don't subscribe to folders.
const NO_FOLDERS: ApiFolder[] = []

export function useActiveVarKeys(): string[] {
  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
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
    const keys = [
      ...folderVars.map((v) => v.key),
      ...personal.map((v) => v.key),
      ...global.filter((v) => !personalKeys.has(v.key)).map((v) => v.key),
    ]
    return [...new Set(keys)]
  }, [environments, activeEnvId, folderId, folders])
}
