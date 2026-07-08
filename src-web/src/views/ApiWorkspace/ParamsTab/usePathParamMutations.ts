import type { RefObject } from "react"
import { removePathParamFromUrl } from "../paramUtils"

type CommitWithUrlFn = (
  newUrl: string,
  pathNames: string[],
  pathValues: Record<string, string>,
  pathEnabled: Record<string, boolean>,
) => Promise<void>

interface UsePathParamMutationsOptions {
  liveUrl: string
  workspaceId: string | null
  allPathParams: string[]
  urlParamSet: Set<string>
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  manualPathParamNames: string[]
  onPathParamValuesChange: (values: Record<string, string>) => void
  onPathParamEnabledChange: (enabled: Record<string, boolean>) => void
  onManualPathParamNamesChange: (names: string[]) => void
  onUrlChanged: (url: string) => void
  setPathParamDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>
  pathParamStableKeys: RefObject<Map<string, string>>
  suppressUrlSync: (url: string) => void
  commitWithUrlRef: RefObject<CommitWithUrlFn>
}

export interface UsePathParamMutationsResult {
  renamePathParam: (oldName: string, newName: string) => Promise<void>
  removePathParam: (name: string) => Promise<void>
}

/** Rename/remove mutations for path params — both may rewrite the URL and re-commit. */
export function usePathParamMutations({
  liveUrl,
  workspaceId,
  allPathParams,
  urlParamSet,
  pathParamValues,
  pathParamEnabled,
  manualPathParamNames,
  onPathParamValuesChange,
  onPathParamEnabledChange,
  onManualPathParamNamesChange,
  onUrlChanged,
  setPathParamDisplayOrder,
  pathParamStableKeys,
  suppressUrlSync,
  commitWithUrlRef,
}: UsePathParamMutationsOptions): UsePathParamMutationsResult {
  async function renamePathParam(oldName: string, newName: string) {
    if (!workspaceId || !newName || oldName === newName) return
    if (allPathParams.some((n) => n !== oldName && n === newName)) return

    const existingKey = pathParamStableKeys.current.get(oldName)
    if (existingKey) {
      pathParamStableKeys.current.delete(oldName)
      pathParamStableKeys.current.set(newName, existingKey)
    }
    setPathParamDisplayOrder((prev) =>
      prev.map((n) => (n === oldName ? newName : n)),
    )

    const { [oldName]: wasEnabled, ...restEnabled } = pathParamEnabled
    onPathParamEnabledChange({ ...restEnabled, [newName]: wasEnabled ?? true })
    if (manualPathParamNames.includes(oldName)) {
      onManualPathParamNamesChange(
        manualPathParamNames.map((n) => (n === oldName ? newName : n)),
      )
    }
    const { [oldName]: val, ...rest } = pathParamValues
    const newValues = { ...rest, [newName]: val ?? "" }
    onPathParamValuesChange(newValues)

    if (urlParamSet.has(oldName)) {
      const newUrl = liveUrl.replace(
        new RegExp(`:${oldName}(?=[/?#]|$)`),
        `:${newName}`,
      )
      const renamedNames = allPathParams.map((n) =>
        n === oldName ? newName : n,
      )
      const { [oldName]: wasEnabled2, ...restEnabled2 } = pathParamEnabled
      const newEnabled = { ...restEnabled2, [newName]: wasEnabled2 ?? true }
      suppressUrlSync(newUrl)
      onUrlChanged(newUrl)
      await commitWithUrlRef.current(
        newUrl,
        renamedNames,
        newValues,
        newEnabled,
      )
    }
  }

  async function removePathParam(name: string) {
    if (!workspaceId) return
    setPathParamDisplayOrder((prev) => prev.filter((n) => n !== name))
    onManualPathParamNamesChange(manualPathParamNames.filter((n) => n !== name))
    const { [name]: _v, ...restValues } = pathParamValues
    onPathParamValuesChange(restValues)
    const { [name]: _e, ...restEnabled } = pathParamEnabled
    onPathParamEnabledChange(restEnabled)

    if (urlParamSet.has(name)) {
      const newUrl = removePathParamFromUrl(liveUrl, name)
      const remainingNames = allPathParams.filter((n) => n !== name)
      const { [name]: _v2, ...remainingValues } = pathParamValues
      const { [name]: _e2, ...remainingEnabled } = pathParamEnabled
      suppressUrlSync(newUrl)
      onUrlChanged(newUrl)
      await commitWithUrlRef.current(
        newUrl,
        remainingNames,
        remainingValues,
        remainingEnabled,
      )
    }
  }

  return { renamePathParam, removePathParam }
}
