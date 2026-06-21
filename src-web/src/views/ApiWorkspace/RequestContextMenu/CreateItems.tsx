import type { ReactNode } from "react"
import { Glyph } from "@/components/Glyph"
import { ITEM_CLASSES, SEP } from "./contextMenuStyles"

interface Props {
  folderId?: string
  onCreateRequest: (folderId?: string) => void
  onCreateGraphql: (folderId?: string) => void
  onCreateConnection: (folderId?: string) => void
  onCreateGrpc: (folderId?: string) => void
  onCreateFolder: (folderId?: string) => void
}

export function CreateItems({
  folderId,
  onCreateRequest,
  onCreateGraphql,
  onCreateConnection,
  onCreateGrpc,
  onCreateFolder,
}: Props) {
  const item = (label: string, onClick: () => void): ReactNode => (
    <button type="button" className={ITEM_CLASSES} onClick={onClick}>
      <Glyph kind="plus" size={13} color="var(--base04)" />
      <span>{label}</span>
    </button>
  )
  return (
    <>
      {item("Request", () => onCreateRequest(folderId))}
      {item("GraphQL", () => onCreateGraphql(folderId))}
      {item("WebSocket", () => onCreateConnection(folderId))}
      {item("gRPC", () => onCreateGrpc(folderId))}
      <div className={SEP} />
      {item("Folder", () => onCreateFolder(folderId))}
    </>
  )
}
