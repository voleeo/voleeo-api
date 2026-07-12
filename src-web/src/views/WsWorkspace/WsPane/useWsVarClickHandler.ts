import { useCallback } from "react"
import { findFolderVarSource } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import { revealInTree } from "@/views/ApiWorkspace/revealInTree"
import {
  type EnvFocusTarget,
  envFocusTarget,
  systemHasVar,
} from "@/views/EnvironmentsModal/focusTarget"

/** Var-chip click resolution: folder vars win over env vars, then exposed
 *  system vars; misses toast. `onOpenEnvModal` is invoked only when the var
 *  lives on an environment or the System block — folder hops are handled
 *  internally via `revealInTree`. */
export function useWsVarClickHandler(
  folderId: string | null,
  onOpenEnvModal: (target: EnvFocusTarget) => void,
) {
  return useCallback(
    (varName: string) => {
      const all = useRequestStore.getState().folders
      const sourceFolderId = findFolderVarSource(folderId, all, varName)
      if (sourceFolderId) {
        revealInTree(sourceFolderId, sourceFolderId, all)
        useRequestStore.getState().focusFolderVariable(sourceFolderId, varName)
        return
      }
      const envHas = useEnvironmentStore
        .getState()
        .environments.some((e) => e.variables.some((v) => v.key === varName))
      if (envHas) onOpenEnvModal(envFocusTarget(varName, false))
      else if (systemHasVar(varName))
        onOpenEnvModal(envFocusTarget(varName, true))
      else
        useToastStore
          .getState()
          .show(`Variable "${varName}" doesn't exist anymore`, 4000, "error")
    },
    [folderId, onOpenEnvModal],
  )
}
