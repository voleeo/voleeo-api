import type { Dispatch, SetStateAction } from "react"
import { createPortal } from "react-dom"
import { EnableEncryptionDialog } from "@/components/EnableEncryptionDialog"
import { TemplateFunctionModal } from "@/components/TemplateFunctionModal"
import type { BoundTemplateFunction } from "@/plugins/types"
import { Autocomplete, type AutocompleteItem } from "./useUrlAutocomplete"
import type { FuncModalState } from "./useUrlFuncModal"

interface Props {
  acOpen: boolean
  acItems: AutocompleteItem[]
  acIdx: number
  acQuery: string
  anchorRect: DOMRect | null
  selectUrlItem: (item: AutocompleteItem) => void
  closeAutocomplete: () => void
  showEncryptionDialog: boolean
  activeWorkspaceId: string | null
  setShowEncryptionDialog: Dispatch<SetStateAction<boolean>>
  funcModal: FuncModalState | null
  setFuncModal: Dispatch<SetStateAction<FuncModalState | null>>
  fns: BoundTemplateFunction[]
  handleFuncModalInsert: (args: Record<string, string>) => void | Promise<void>
}

/** Autocomplete dropdown + encryption/function modals for UrlInput, portalled to `document.body`. */
export function UrlInputModals({
  acOpen,
  acItems,
  acIdx,
  acQuery,
  anchorRect,
  selectUrlItem,
  closeAutocomplete,
  showEncryptionDialog,
  activeWorkspaceId,
  setShowEncryptionDialog,
  funcModal,
  setFuncModal,
  fns,
  handleFuncModalInsert,
}: Props) {
  return (
    <>
      {acOpen &&
        anchorRect &&
        acItems.length > 0 &&
        createPortal(
          <Autocomplete
            items={acItems}
            selectedIndex={acIdx}
            anchorRect={anchorRect}
            query={acQuery}
            onSelect={selectUrlItem}
            onClose={closeAutocomplete}
          />,
          document.body,
        )}

      {showEncryptionDialog &&
        activeWorkspaceId &&
        createPortal(
          <EnableEncryptionDialog
            workspaceId={activeWorkspaceId}
            onEnabled={() => setShowEncryptionDialog(false)}
            onCancel={() => setShowEncryptionDialog(false)}
          />,
          document.body,
        )}

      {funcModal &&
        createPortal(
          <TemplateFunctionModal
            fn={
              fns.find((f) => f.name === funcModal.fnName) ??
              ({ name: funcModal.fnName, onRender: () => "" } as never)
            }
            initialArgs={funcModal.initialArgs}
            onInsert={handleFuncModalInsert}
            onClose={() => setFuncModal(null)}
          />,
          document.body,
        )}
    </>
  )
}
