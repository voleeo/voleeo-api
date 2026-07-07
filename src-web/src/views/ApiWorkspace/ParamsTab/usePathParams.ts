import type { RefObject } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { extractPathParams, nextId } from "../paramUtils"
import { usePathParamMutations } from "./usePathParamMutations"

export interface UsePathParamsResult {
  allPathParams: string[]
  urlParamSet: Set<string>
  pathParamDisplayOrder: string[]
  setPathParamDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>
  getStableKey: (name: string) => string
  pathParamInputRef: (name: string) => (el: HTMLDivElement | null) => void
  pendingKeyFocusName: string | null
  setPendingKeyFocusName: React.Dispatch<React.SetStateAction<string | null>>
  updatePathParamValue: (name: string, val: string) => void
  togglePathParam: (name: string) => void
  renamePathParam: (oldName: string, newName: string) => Promise<void>
  removePathParam: (name: string) => Promise<void>
  suppressUrlSync: (url: string) => void
  commitPathParamsRef: RefObject<
    (nv: Record<string, string>, ne: Record<string, boolean>) => Promise<void>
  >
  commitWithUrlRef: RefObject<
    (
      newUrl: string,
      pathNames: string[],
      pathValues: Record<string, string>,
      pathEnabled: Record<string, boolean>,
    ) => Promise<void>
  >
}

interface UsePathParamsOptions {
  url: string
  liveUrl: string
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  manualPathParamNames: string[]
  onPathParamValuesChange: (values: Record<string, string>) => void
  onPathParamEnabledChange: (enabled: Record<string, boolean>) => void
  onManualPathParamNamesChange: (names: string[]) => void
  onUrlChanged: (url: string) => void
  focusedPathParam: string | null | undefined
  onFocusedPathParamConsumed: (() => void) | undefined
  workspaceId: string | null
}

export function usePathParams({
  url,
  liveUrl,
  pathParamValues,
  pathParamEnabled,
  manualPathParamNames,
  onPathParamValuesChange,
  onPathParamEnabledChange,
  onManualPathParamNamesChange,
  onUrlChanged,
  focusedPathParam,
  onFocusedPathParamConsumed,
  workspaceId,
}: UsePathParamsOptions): UsePathParamsResult {
  // Commit refs — created here, `.current` updated by the parent each render.
  const commitPathParamsRef = useRef<
    (nv: Record<string, string>, ne: Record<string, boolean>) => Promise<void>
  >(async () => {})
  const commitWithUrlRef = useRef<
    (
      newUrl: string,
      pathNames: string[],
      pathValues: Record<string, string>,
      pathEnabled: Record<string, boolean>,
    ) => Promise<void>
  >(async () => {})

  // Stable render keys
  const pathParamStableKeys = useRef<Map<string, string>>(new Map())
  const getStableKey = (name: string): string => {
    if (!pathParamStableKeys.current.has(name)) {
      pathParamStableKeys.current.set(name, `pp-${nextId()}`)
    }
    // biome-ignore lint/style/noNonNullAssertion: key is guaranteed by the .set() call above
    return pathParamStableKeys.current.get(name)!
  }

  // Focus management
  const [pendingKeyFocusName, setPendingKeyFocusName] = useState<string | null>(
    null,
  )
  const pathParamInputRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pathParamInputRef = (name: string) => (el: HTMLDivElement | null) => {
    if (el) pathParamInputRefs.current.set(name, el)
    else pathParamInputRefs.current.delete(name)
  }

  useEffect(() => {
    if (!focusedPathParam) return
    const input = pathParamInputRefs.current.get(focusedPathParam)
    if (input) {
      input.focus()
      onFocusedPathParamConsumed?.()
    }
  }, [focusedPathParam, onFocusedPathParamConsumed])

  // Derived param sets
  const urlPathParams = useMemo(() => extractPathParams(liveUrl), [liveUrl])
  const urlParamSet = useMemo(() => new Set(urlPathParams), [urlPathParams])
  const extraPathParams = useMemo(
    () => manualPathParamNames.filter((n) => !urlParamSet.has(n)),
    [manualPathParamNames, urlParamSet],
  )
  const allPathParams = useMemo(
    () => [...urlPathParams, ...extraPathParams],
    [urlPathParams, extraPathParams],
  )

  // Display order — preserved across drag; updated when param set changes
  const [pathParamDisplayOrder, setPathParamDisplayOrder] = useState<string[]>(
    () => [...urlPathParams, ...extraPathParams],
  )
  const prevParamSetKeyRef = useRef("")
  useEffect(() => {
    const sortedKey = [...allPathParams].sort().join("\0")
    if (sortedKey === prevParamSetKeyRef.current) return
    prevParamSetKeyRef.current = sortedKey
    const currentSet = new Set(allPathParams)
    setPathParamDisplayOrder((prev) => {
      const kept = prev.filter((n) => currentSet.has(n))
      const keptSet = new Set(kept)
      const added = allPathParams.filter((n) => !keptSet.has(n))
      return [...kept, ...added]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPathParams])

  // Prune manual names that disappear from the URL
  const prevUrlRef = useRef(url)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only fires on URL change; reads manualPathParamNames via closure to avoid looping on list mutations
  useEffect(() => {
    if (url === prevUrlRef.current) return
    prevUrlRef.current = url
    const urlParams = new Set(extractPathParams(url))
    const stillManual = manualPathParamNames.filter((n) => !urlParams.has(n))
    if (stillManual.length !== manualPathParamNames.length) {
      onManualPathParamNamesChange(stillManual)
    }
  }, [url])

  const suppressUrlSync = (url: string) => {
    prevUrlRef.current = url
  }

  // Mutations
  function updatePathParamValue(name: string, val: string) {
    const newValues = { ...pathParamValues, [name]: val }
    onPathParamValuesChange(newValues)
    void commitPathParamsRef.current(newValues, pathParamEnabled)
  }

  function togglePathParam(name: string) {
    const newEnabled = {
      ...pathParamEnabled,
      [name]: pathParamEnabled[name] === false,
    }
    onPathParamEnabledChange(newEnabled)
    void commitPathParamsRef.current(pathParamValues, newEnabled)
  }

  const { renamePathParam, removePathParam } = usePathParamMutations({
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
  })

  return {
    allPathParams,
    urlParamSet,
    pathParamDisplayOrder,
    setPathParamDisplayOrder,
    getStableKey,
    pathParamInputRef,
    pendingKeyFocusName,
    setPendingKeyFocusName,
    updatePathParamValue,
    togglePathParam,
    renamePathParam,
    removePathParam,
    suppressUrlSync,
    commitPathParamsRef,
    commitWithUrlRef,
  }
}
