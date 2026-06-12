import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useEnvironmentStore } from "@/store/environment"

export function useActiveVarKeys(): string[] {
  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
    })),
  )

  return useMemo(() => {
    const enabled = (
      kindMatch: (e: (typeof environments)[number]) => boolean,
    ) => environments.find(kindMatch)?.variables.filter((v) => v.enabled) ?? []
    const personal = enabled((e) => e.id === activeEnvId)
    const global = enabled((e) => e.kind === "global")
    const personalKeys = new Set(personal.map((v) => v.key))
    return [
      ...personal.map((v) => v.key),
      ...global.filter((v) => !personalKeys.has(v.key)).map((v) => v.key),
    ]
  }, [environments, activeEnvId])
}
