import { useCallback, useEffect, useRef, useState } from "react"
import { findFolderVarSource } from "@/lib/folderChain"
import { useEnvironmentStore } from "@/store/environment"
import { usePaneTabsStore } from "@/store/paneTabs"
import type {
  ApiFolder,
  AuthConfig,
  EnvironmentVariable,
  RequestParameter,
} from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import {
  type EnvFocusTarget,
  envFocusTarget,
  systemHasVar,
} from "@/views/EnvironmentsModal/focusTarget"
import { revealInTree } from "../revealInTree"
import { propagateFolderVariableRename } from "./propagateFolderVariableRename"

export type FolderTab = "headers" | "auth" | "variables"

export function useFolderPaneHandlers(
  folder: ApiFolder | null,
  activeWorkspaceId: string | null,
) {
  const updateFolder = useRequestStore((s) => s.updateFolder)
  const updateFolderVariables = useRequestStore((s) => s.updateFolderVariables)
  const pendingFolderFocus = useRequestStore((s) => s.pendingFolderFocus)
  const consumePendingFolderFocus = useRequestStore(
    (s) => s.consumePendingFolderFocus,
  )

  // Tab restored from per-folder memory on initial mount and on folder switch.
  const initialFolderId = folder?.id ?? null
  const [activeTab, setActiveTabState] = useState<FolderTab>(
    initialFolderId
      ? ((usePaneTabsStore.getState().folderTabs[
          initialFolderId
        ] as FolderTab) ?? "headers")
      : "headers",
  )
  const setActiveTab = useCallback(
    (next: FolderTab) => {
      setActiveTabState(next)
      const id = folder?.id
      if (id) usePaneTabsStore.getState().setFolderTab(id, next)
    },
    [folder?.id],
  )
  const [varFocusKey, setVarFocusKey] = useState<string | undefined>(undefined)
  const [headerFocusKey, setHeaderFocusKey] = useState<string | undefined>(
    undefined,
  )
  const [envModalVar, setEnvModalVar] = useState<EnvFocusTarget | null>(null)

  // Restore the saved tab when the active folder changes.
  const prevFolderIdRef = useRef<string | null>(folder?.id ?? null)
  useEffect(() => {
    const id = folder?.id ?? null
    if (id === prevFolderIdRef.current) return
    prevFolderIdRef.current = id
    const saved = id
      ? (usePaneTabsStore.getState().folderTabs[id] as FolderTab | undefined)
      : undefined
    setActiveTabState(saved ?? "headers")
  }, [folder?.id])

  useEffect(() => {
    if (!folder || pendingFolderFocus?.folderId !== folder.id) return
    setActiveTab(pendingFolderFocus.tab)
    if (pendingFolderFocus.tab === "variables") {
      setVarFocusKey(pendingFolderFocus.key)
    } else {
      setHeaderFocusKey(pendingFolderFocus.key)
    }
    consumePendingFolderFocus()
  }, [folder, pendingFolderFocus, consumePendingFolderFocus, setActiveTab])

  const saveHeaders = useCallback(
    async (hdrs: RequestParameter[]) => {
      if (!activeWorkspaceId || !folder) return
      await updateFolder(
        activeWorkspaceId,
        folder.id,
        hdrs,
        folder.auth ?? { kind: "none" },
      )
    },
    [activeWorkspaceId, folder, updateFolder],
  )

  const saveAuth = useCallback(
    async (next: AuthConfig) => {
      if (!activeWorkspaceId || !folder) return
      await updateFolder(
        activeWorkspaceId,
        folder.id,
        folder.headers ?? [],
        next,
      )
    },
    [activeWorkspaceId, folder, updateFolder],
  )

  const saveVariables = useCallback(
    (variables: EnvironmentVariable[]) => {
      if (!activeWorkspaceId || !folder) return
      void updateFolderVariables(activeWorkspaceId, folder.id, variables)
    },
    [activeWorkspaceId, folder, updateFolderVariables],
  )

  const renameVariable = useCallback(
    (oldKey: string, newKey: string) => {
      if (!activeWorkspaceId || !folder) return
      void propagateFolderVariableRename(
        activeWorkspaceId,
        folder.id,
        oldKey,
        newKey,
      )
    },
    [activeWorkspaceId, folder],
  )

  const handleVarClick = useCallback(
    (varName: string) => {
      const folderId = folder?.id
      if (!folderId) return
      const allFolders = useRequestStore.getState().folders
      const source = findFolderVarSource(folderId, allFolders, varName)
      if (source) {
        revealInTree(source, source, allFolders)
        useRequestStore.getState().focusFolderVariable(source, varName)
      } else if (
        useEnvironmentStore
          .getState()
          .environments.some((e) => e.variables.some((v) => v.key === varName))
      ) {
        setEnvModalVar(envFocusTarget(varName, false))
      } else if (systemHasVar(varName)) {
        setEnvModalVar(envFocusTarget(varName, true))
      } else {
        useToastStore
          .getState()
          .show(`Variable "${varName}" doesn't exist anymore`, 4000, "error")
      }
    },
    [folder?.id],
  )

  return {
    activeTab,
    setActiveTab,
    varFocusKey,
    headerFocusKey,
    envModalVar,
    setEnvModalVar,
    saveHeaders,
    saveAuth,
    saveVariables,
    renameVariable,
    handleVarClick,
  }
}
