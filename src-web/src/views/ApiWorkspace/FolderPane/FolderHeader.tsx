import { useRef, useState } from "react"
import { ColorPickerPopover } from "@/components/ColorPickerPopover"
import { Glyph } from "@/components/Glyph"
import type { ApiFolder } from "@/store/requests"
import { useRequestStore } from "@/store/requests"

interface Props {
  folder: ApiFolder
  activeWorkspaceId: string | null
}

export function FolderHeader({ folder, activeWorkspaceId }: Props) {
  const updateFolderColor = useRequestStore((s) => s.updateFolderColor)
  const renameFolder = useRequestStore((s) => s.renameFolder)

  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState("")

  const folderColor = folder.color ?? null
  const iconColor = folderColor ?? "var(--base04)"

  function openPicker() {
    setPickerAnchor(colorBtnRef.current?.getBoundingClientRect() ?? null)
  }

  async function handleColorChange(hex: string) {
    if (!activeWorkspaceId) return
    await updateFolderColor(activeWorkspaceId, folder.id, hex)
  }

  function startEditingName() {
    setNameValue(folder.name)
    setEditingName(true)
  }

  async function commitRename() {
    const trimmed = nameValue.trim()
    if (!activeWorkspaceId || !trimmed || trimmed === folder.name) {
      setEditingName(false)
      return
    }
    await renameFolder(activeWorkspaceId, folder.id, trimmed)
    setEditingName(false)
  }

  return (
    <>
      <div className="px-3.5 min-h-[40px] border-b border-border flex items-center gap-2 shrink-0">
        <button
          ref={colorBtnRef}
          type="button"
          onClick={openPicker}
          className="shrink-0 flex items-center justify-center cursor-pointer border-0 outline-none bg-transparent p-0 rounded-[3px] hover:bg-subtle w-6 h-6"
          title="Change folder color"
          aria-label="Change folder color"
        >
          <Glyph kind="folder" size={16} color={iconColor} />
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") setEditingName(false)
            }}
            className="font-sans text-[0.929rem] text-fg bg-transparent border-0 outline-none select-text min-w-0 flex-1 max-w-[320px]"
          />
        ) : (
          <span
            onClick={startEditingName}
            onKeyDown={(e) => {
              if (e.key === "Enter") startEditingName()
            }}
            role="button"
            tabIndex={0}
            title="Click to rename"
            className="font-sans text-[0.929rem] text-fg truncate cursor-text select-none outline-none"
          >
            {folder.name}
          </span>
        )}
      </div>

      {pickerAnchor && (
        <ColorPickerPopover
          color={folderColor ?? "var(--base04)"}
          anchorRect={pickerAnchor}
          onChange={handleColorChange}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  )
}
