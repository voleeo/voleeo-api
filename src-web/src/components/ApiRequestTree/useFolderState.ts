import { useCallback, useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTreeUiStore } from "@/store/treeUi"

export interface FolderStateHandle {
  isFolderOpen: (id: string) => boolean
  toggleFolder: (id: string) => void
}

export function useFolderState(workspaceId: string): FolderStateHandle {
  const { initForWorkspace, toggleFolder } = useTreeUiStore(
    useShallow((s) => ({
      initForWorkspace: s.initForWorkspace,
      toggleFolder: s.toggleFolder,
    })),
  )
  const closedFolderIds = useTreeUiStore((s) => s.closedFolderIds)
  const isFolderOpen = useCallback(
    (id: string) => !closedFolderIds.includes(id),
    [closedFolderIds],
  )

  useEffect(() => {
    initForWorkspace(workspaceId)
  }, [workspaceId, initForWorkspace])

  return useMemo(
    () => ({ isFolderOpen, toggleFolder }),
    [isFolderOpen, toggleFolder],
  )
}
