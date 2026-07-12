import { useCallback, useState } from "react"
import { findFolderVarSource } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { usePaneTabsStore } from "@/store/paneTabs"
import type { HttpRequest } from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import {
  type EnvFocusTarget,
  envFocusTarget,
  systemHasVar,
} from "@/views/EnvironmentsModal/focusTarget"
import { revealInTree } from "../revealInTree"
import type { RequestTab } from "./TabBar"

/** True when any environment still defines `key` — used to decide whether a
 *  clicked var chip opens the env manager or is a dangling reference. */
function envHasVar(key: string): boolean {
  return useEnvironmentStore
    .getState()
    .environments.some((e) => e.variables.some((v) => v.key === key))
}

/** Owns the request pane's local interaction state — active tab, path-param
 *  focus, pending query params, param counts, env-modal target — and the
 *  handlers that drive it (URL chip clicks, variable navigation). */
export function useRequestPaneHandlers(activeRequest: HttpRequest | null) {
  // Initial tab pulled from the per-request memory store (defaults to "params").
  const initialId = activeRequest?.id ?? null
  const [activeTab, setActiveTabState] = useState<RequestTab>(
    initialId
      ? ((usePaneTabsStore.getState().requestTabs[initialId] as RequestTab) ??
          "params")
      : "params",
  )
  const setActiveTab = useCallback(
    (next: RequestTab) => {
      setActiveTabState(next)
      const id = activeRequest?.id
      if (id) usePaneTabsStore.getState().setRequestTab(id, next)
    },
    [activeRequest?.id],
  )
  const [focusedPathParam, setFocusedPathParam] = useState<string | null>(null)
  const [envModalVar, setEnvModalVar] = useState<EnvFocusTarget | null>(null)
  const [paramCounts, setParamCounts] = useState<{
    enabled: number
    total: number
  } | null>(null)
  const [pendingQueryParams, setPendingQueryParams] = useState<Array<{
    key: string
    value: string
  }> | null>(null)

  // On request switch, restore that request's last-active tab (or default to
  // "params" for ones we've never seen). Param counts / pending params remain
  // tied to the previously active request, so reset them.
  const onRequestSwitched = useCallback((nextRequestId: string | null) => {
    setParamCounts(null)
    setPendingQueryParams(null)
    const saved = nextRequestId
      ? (usePaneTabsStore.getState().requestTabs[nextRequestId] as
          | RequestTab
          | undefined)
      : undefined
    setActiveTabState(saved ?? "params")
  }, [])

  const handleFocusedPathParamConsumed = useCallback(
    () => setFocusedPathParam(null),
    [],
  )
  const handleParamCountChange = useCallback(
    (enabled: number, total: number) =>
      setParamCounts((prev) =>
        prev?.enabled === enabled && prev?.total === total
          ? prev
          : { enabled, total },
      ),
    [],
  )
  const handlePendingQueryParamsConsumed = useCallback(
    () => setPendingQueryParams(null),
    [],
  )
  // Folder vars win at send time, so a chip resolving to one navigates to its
  // folder's Variables tab; otherwise fall back to the environments modal.
  const handleVarClick = useCallback(
    (varName: string) => {
      const folders = useRequestStore.getState().folders
      const sourceFolderId = findFolderVarSource(
        activeRequest?.folderId ?? null,
        folders,
        varName,
      )
      if (sourceFolderId) {
        revealInTree(sourceFolderId, sourceFolderId, folders)
        useRequestStore.getState().focusFolderVariable(sourceFolderId, varName)
      } else if (envHasVar(varName)) {
        setEnvModalVar(envFocusTarget(varName, false))
      } else if (systemHasVar(varName)) {
        setEnvModalVar(envFocusTarget(varName, true))
      } else {
        useToastStore
          .getState()
          .show(`Variable "${varName}" doesn't exist anymore`, 4000, "error")
      }
    },
    [activeRequest?.folderId],
  )
  const handleUrlParamClick = useCallback(
    (name: string) => {
      setActiveTab("params")
      setFocusedPathParam(name)
    },
    [setActiveTab],
  )
  const handleUrlQueryParams = useCallback(
    (params: Array<{ key: string; value: string }>) => {
      setPendingQueryParams(params)
      setActiveTab("params")
    },
    [setActiveTab],
  )

  return {
    activeTab,
    setActiveTab,
    focusedPathParam,
    envModalVar,
    setEnvModalVar,
    paramCounts,
    pendingQueryParams,
    onRequestSwitched,
    handleFocusedPathParamConsumed,
    handleParamCountChange,
    handlePendingQueryParamsConsumed,
    handleVarClick,
    handleUrlParamClick,
    handleUrlQueryParams,
  }
}
