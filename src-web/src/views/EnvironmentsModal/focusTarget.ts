import { useEnvironmentStore } from "@/store/environment"

/** Where a clicked `{{ VAR }}` chip navigates inside the Environments modal. */
export interface EnvFocusTarget {
  key: string
  /** Allowlisted OS var: flash the System block, no editable value to focus. */
  system?: boolean
  /** Bumped every click so re-clicking the same chip re-fires the focus/flash. */
  nonce: number
}

export function envFocusTarget(key: string, system: boolean): EnvFocusTarget {
  return { key, system, nonce: performance.now() }
}

export function systemHasVar(key: string): boolean {
  return useEnvironmentStore.getState().systemEnvVars.some((v) => v.key === key)
}
