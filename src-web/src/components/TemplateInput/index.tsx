import { type Ref, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { EnableEncryptionDialog } from "@/components/EnableEncryptionDialog"
import {
  type RequestFnName,
  RequestFunctionModal,
} from "@/components/RequestFunctionModal"
import { ResponseFunctionModal } from "@/components/ResponseFunctionModal"
import { TemplateFunctionModal } from "@/components/TemplateFunctionModal"
import { toHtml } from "@/lib/template"
import { cn } from "@/lib/utils"
import type { ConstantSuggestion } from "./Autocomplete"
import { Autocomplete } from "./Autocomplete"
import { useAutocomplete } from "./useAutocomplete"
import { useEditorSync } from "./useEditorSync"
import { useFuncModal } from "./useFuncModal"
import { useInputHandlers } from "./useInputHandlers"
import { useTemplateInputData } from "./useTemplateInputData"

export interface TemplateInputProps {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  placeholder?: string
  disabled?: boolean
  onVarClick?: (varName: string) => void
  excludeVarKeys?: string[]
  onEncryptInsert?: (plaintext: string) => void
  className?: string
  ref?: Ref<HTMLDivElement>
  constantItems?: ConstantSuggestion[]
  onConstantSelect?: (value: string) => void
  /**
   * When true, the editor wraps and preserves newlines (textarea-like).
   * Enter inserts a real `\n`; the stored value keeps newlines.
   * When false (default), Enter calls `onCommit` and newlines are stripped.
   */
  multiline?: boolean
}

export function TemplateInput({
  value,
  onChange,
  onCommit,
  placeholder,
  disabled,
  onVarClick,
  excludeVarKeys,
  onEncryptInsert,
  className,
  ref: forwardedRef,
  constantItems,
  onConstantSelect,
  multiline,
}: TemplateInputProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const skipSyncRef = useRef(false)

  const {
    activeVars,
    fns,
    isEncryptionEnabled,
    activeWorkspaceId,
    varStatus,
    funcStatus,
  } = useTemplateInputData()

  const buildHtml = useCallback(
    (text: string) => {
      const html = toHtml(text, varStatus, funcStatus)
      // Chrome's contenteditable doesn't render a trailing `\n` under
      // `white-space: pre-wrap` as a visible empty line — the caret stays
      // stuck on the previous row. Append a zero-width space so the empty
      // line has "content" to render against. `extractStoredValue` strips
      // it back out in multiline mode.
      return multiline && text.endsWith("\n") ? `${html}​` : html
    },
    [varStatus, funcStatus, multiline],
  )

  // Break circular dep: useAutocomplete.insertToken ↔ useFuncModal.handleFuncModalInsert.
  // A ref lets us wire them without requiring either hook to be declared first.
  const insertTokenRef = useRef<
    (storedToken: string, fromDisplay: number, toDisplay: number) => void
  >(() => {})

  const {
    funcModal,
    setFuncModal,
    showEncryptionDialog,
    onFuncSelected,
    handleChipClick,
    handleFuncModalInsert,
    onEncryptionEnabled,
    onEncryptionCancelled,
  } = useFuncModal({
    fns,
    isEncryptionEnabled,
    activeWorkspaceId,
    onEncryptInsert,
    buildHtml,
    onChange,
    divRef,
    skipSyncRef,
    insertToken: (t, f, to) => insertTokenRef.current(t, f, to),
  })

  const {
    acOpen,
    acItems,
    acIdx,
    acNsFilter,
    acQuery,
    anchorRect,
    setAcIdx,
    openAutocomplete,
    closeAutocomplete,
    getPartialExpr,
    insertToken,
    selectItem,
  } = useAutocomplete({
    divRef,
    activeVars,
    fns,
    excludeVarKeys,
    multiline,
    buildHtml,
    skipSyncRef,
    onChange,
    onFuncSelect: onFuncSelected,
    constantItems,
    onConstantSelect,
  })

  // Keep the ref current so useFuncModal always calls the latest insertToken.
  insertTokenRef.current = insertToken

  useEditorSync({
    divRef,
    value,
    buildHtml,
    varStatus,
    forwardedRef,
    skipSyncRef,
  })

  const {
    handleInput,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handlePaste,
    handleKeyDown,
    handleClick,
    handleMouseDown,
  } = useInputHandlers({
    buildHtml,
    skipSyncRef,
    onChange,
    onCommit,
    onVarClick,
    multiline,
    acOpen,
    acItems,
    acIdx,
    acNsFilter,
    setAcIdx,
    openAutocomplete,
    closeAutocomplete,
    getPartialExpr,
    selectItem,
    handleChipClick,
  })

  return (
    <>
      <div
        ref={divRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        data-placeholder={placeholder}
        className={cn(
          "ce-placeholder text-fg outline-none leading-[1.5] min-w-0",
          multiline
            ? "whitespace-pre-wrap break-words"
            : "whitespace-nowrap overflow-hidden",
          disabled && "opacity-40 cursor-not-allowed pointer-events-none",
          className,
        )}
        onMouseDown={handleMouseDown}
        onBeforeInput={handleBeforeInput}
        onInput={handleInput}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onBlur={() => {
          if (acOpen) return
          onCommit?.()
          if (!multiline && divRef.current) divRef.current.scrollLeft = 0
        }}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      />

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
