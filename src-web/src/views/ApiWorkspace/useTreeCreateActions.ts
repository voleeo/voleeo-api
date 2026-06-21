import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"

type CreateFn = (
  wsId: string,
  opts?: { folderId?: string },
) => Promise<{ id: string } | null | undefined>

export function useTreeCreateActions(
  activeWorkspaceId: string | null,
  closeMenu: () => void,
) {
  const make = (create: CreateFn) => async (folderId?: string) => {
    closeMenu()
    if (!activeWorkspaceId) return
    if (folderId) useTreeUiStore.getState().ensureFoldersOpen([folderId])
    const created = await create(
      activeWorkspaceId,
      folderId ? { folderId } : undefined,
    )
    if (created?.id) useTreeUiStore.getState().focusNewItem(created.id)
  }

  const s = useRequestStore.getState
  return {
    handleCreateRequest: make((w, o) => s().createRequest(w, o)),
    handleCreateGraphql: make((w, o) => s().createGraphqlRequest(w, o)),
    handleCreateConnection: make((w, o) => s().createConnection(w, o)),
    handleCreateGrpc: make((w, o) => s().createGrpc(w, o)),
    handleCreateFolder: make((w, o) => s().createFolder(w, o)),
  }
}
