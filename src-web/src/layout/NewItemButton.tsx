import { useCallback, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { useRequestStore } from "@/store/requests"
import { useTreeUiStore } from "@/store/treeUi"
import { useUiStore } from "@/store/workspace"
import { ITEM } from "./gitMenu"

function queueRenameFor(id: string | undefined) {
  if (id) useTreeUiStore.getState().requestRename(id)
}

export function NewItemButton() {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)
  const { createRequest, createFolder, createConnection } = useRequestStore(
    useShallow((s) => ({
      createRequest: s.createRequest,
      createFolder: s.createFolder,
      createConnection: s.createConnection,
    })),
  )

  const openMenu = useCallback(() => {
    wrapperRef.current?.querySelector("button")?.click()
  }, [])
  useKeydown(SHORTCUTS.NEW_ITEM, openMenu)

  function resolveTargetFolderId(): string | null {
    const focusedId = useTreeUiStore.getState().focusedNodeId
    if (!focusedId) return null
    const { folders, requests } = useRequestStore.getState()
    if (folders.some((f) => f.id === focusedId)) {
      useTreeUiStore.getState().ensureFoldersOpen([focusedId])
      return focusedId
    }
    const req = requests.find((r) => r.id === focusedId)
    return req?.folderId ?? null
  }

  async function handleCreateRequest() {
    if (!activeWorkspaceId) return
    setOpen(false)
    const folderId = resolveTargetFolderId()
    const created = await createRequest(
      activeWorkspaceId,
      folderId ? { folderId } : undefined,
    )
    queueRenameFor(created?.id)
  }

  async function handleCreateConnection() {
    if (!activeWorkspaceId) return
    setOpen(false)
    const folderId = resolveTargetFolderId()
    const created = await createConnection(
      activeWorkspaceId,
      folderId ? { folderId } : undefined,
    )
    queueRenameFor(created?.id)
  }

  async function handleCreateFolder() {
    if (!activeWorkspaceId) return
    setOpen(false)
    const folderId = resolveTargetFolderId()
    const created = await createFolder(
      activeWorkspaceId,
      folderId ? { folderId } : undefined,
    )
    queueRenameFor(created?.id)
  }

  return (
    <div ref={wrapperRef}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className="flex items-center justify-center w-7 h-7 rounded-[5px] cursor-pointer bg-transparent border-0 outline-none hover:bg-subtle data-[popup-open]:bg-subtle">
          <Glyph kind="plus" size={14} color="var(--base04)" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem className={ITEM} onClick={handleCreateRequest}>
            <Glyph kind="send" size={13} color="var(--base04)" />
            HTTP Request
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onClick={handleCreateConnection}>
            <Glyph kind="plug-charging" size={13} color="var(--base04)" />
            WebSocket
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onClick={handleCreateFolder}>
            <Glyph kind="folder" size={13} color="var(--base04)" />
            Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
