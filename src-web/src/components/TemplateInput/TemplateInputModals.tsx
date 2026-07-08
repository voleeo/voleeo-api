import type { Dispatch, SetStateAction } from "react"
import { createPortal } from "react-dom"
import { EnableEncryptionDialog } from "@/components/EnableEncryptionDialog"
import {
  type RequestFnName,
  RequestFunctionModal,
} from "@/components/RequestFunctionModal"
import { ResponseFunctionModal } from "@/components/ResponseFunctionModal"
import { TemplateFunctionModal } from "@/components/TemplateFunctionModal"
import type { BoundTemplateFunction } from "@/plugins/types"
import { Autocomplete } from "./Autocomplete"
import type { AutocompleteItem } from "./autocompleteItems"
import type { FuncModalState } from "./useFuncModal"

interface Props {
  acOpen: boolean
  acItems: AutocompleteItem[]
  acIdx: number
  acQuery: string
  anchorRect: DOMRect | null
  selectItem: (item: AutocompleteItem) => void
  closeAutocomplete: () => void
  showEncryptionDialog: boolean
  activeWorkspaceId: string | null
  onEncryptionEnabled: () => void
  onEncryptionCancelled: () => void
  funcModal: FuncModalState | null
  setFuncModal: Dispatch<SetStateAction<FuncModalState | null>>
  fns: BoundTemplateFunction[]
  handleFuncModalInsert: (args: Record<string, string>) => Promise<void>
}

/** Autocomplete dropdown + the three function-editing modals, all portalled to `document.body`. */
export function TemplateInputModals({
  acOpen,
  acItems,
  acIdx,
  acQuery,
  anchorRect,
  selectItem,
  closeAutocomplete,
  showEncryptionDialog,
  activeWorkspaceId,
  onEncryptionEnabled,
  onEncryptionCancelled,
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
            onSelect={selectItem}
            onClose={closeAutocomplete}
          />,
          document.body,
        )}

      {showEncryptionDialog &&
        activeWorkspaceId &&
        createPortal(
          <EnableEncryptionDialog
            workspaceId={activeWorkspaceId}
            onEnabled={onEncryptionEnabled}
            onCancel={onEncryptionCancelled}
          />,
          document.body,
        )}

      {funcModal &&
        createPortal(
          funcModal.fnName === "response.body" ||
            funcModal.fnName === "response.header" ? (
            <ResponseFunctionModal
              fnName={funcModal.fnName}
              initialArgs={funcModal.initialArgs}
              onInsert={handleFuncModalInsert}
              onClose={() => setFuncModal(null)}
            />
          ) : funcModal.fnName.startsWith("request.") ? (
            <RequestFunctionModal
              fnName={funcModal.fnName as RequestFnName}
              initialArgs={funcModal.initialArgs}
              onInsert={handleFuncModalInsert}
              onClose={() => setFuncModal(null)}
            />
          ) : (
            <TemplateFunctionModal
              fn={
                fns.find((f) => f.name === funcModal.fnName) ??
                ({ name: funcModal.fnName, onRender: () => "" } as never)
              }
              initialArgs={funcModal.initialArgs}
              onInsert={handleFuncModalInsert}
              onClose={() => setFuncModal(null)}
            />
          ),
          document.body,
        )}
    </>
  )
}
