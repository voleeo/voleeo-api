import { useEnvironmentStore } from "@/store/environment"

/** Enabled variables of the active environment, with the global environment's
 *  enabled vars merged underneath (active wins on key collisions). Matches what
 *  Send resolves against. */
export function envVars() {
  const { environments, activeEnvId } = useEnvironmentStore.getState()
  const globalVars =
    environments
      .find((e) => e.kind === "global")
      ?.variables.filter((v) => v.enabled) ?? []
  const activeVars =
    environments
      .find((e) => e.id === activeEnvId)
      ?.variables.filter((v) => v.enabled) ?? []
  const activeKeys = new Set(activeVars.map((v) => v.key))
  return [...activeVars, ...globalVars.filter((v) => !activeKeys.has(v.key))]
}
