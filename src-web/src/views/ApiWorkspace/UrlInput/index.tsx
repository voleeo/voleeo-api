import { useCallback, useLayoutEffect, useRef } from "react"
import { useTemplateInputData } from "@/components/TemplateInput/useTemplateInputData"
import {
  ensureTrailingTextNode,
  getCaretOffset,
  setCaretOffset,
} from "@/lib/caret"
import type { CommandImportResult } from "@/lib/commandImport"
import { cn } from "@/lib/utils"
import { UrlInputModals } from "./UrlInputModals"
import { toHtml } from "./urlTokenizer"
import { useUrlAutocomplete } from "./useUrlAutocomplete"
import { useUrlFuncModal } from "./useUrlFuncModal"
import { useUrlInputHandlers } from "./useUrlInputHandlers"
import { useUrlMouseHandlers } from "./useUrlMouseHandlers"

interface Props {
  value: string
  disabled: boolean
  onChange: (v: string) => void
  onCommit: () => void
  onSend: () => void
  onParamClick?: (paramName: string) => void
  onVarClick?: (varName: string) => void
  /** Called when the user types or pastes a `?` — carries the extracted params. */
  onQueryParams?: (params: Array<{ key: string; value: string }>) => void
  /** Called when the user pastes a curl/httpie command into an empty URL bar. */
  onImportCommand?: (result: CommandImportResult) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Render the value (with chips) but non-editable and at full opacity — for
   *  a saved snapshot's frozen URL. Unlike `disabled`, no dimming or placeholder. */
  readOnly?: boolean
}

export function UrlInput({
  value,
  disabled,
  onChange,
  onCommit,
  onSend,
  onParamClick,
  onVarClick,
  onQueryParams,
  onImportCommand,
  onFocus,
  onBlur,
  readOnly = false,
}: Props) {
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
    (text: string) => toHtml(text, varStatus, funcStatus),
    [varStatus, funcStatus],
  )

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
    insertUrlToken,
    selectUrlItem,
  } = useUrlAutocomplete({
    divRef,
    activeVars,
    fns,
    buildHtml,
    skipSyncRef,
    onChange,
    // biome-ignore lint/correctness/useExhaustiveDependencies: setShowEncryptionDialog and setFuncModal are useState setters — always stable
    onFuncSelect: useCallback(
      (fn) => {
        if (fn.name === "encrypt" && !isEncryptionEnabled) {
          setShowEncryptionDialog(true)
        } else {
          setFuncModal({ fnName: fn.name, initialArgs: {}, oldToken: "" })
        }
      },
      [isEncryptionEnabled],
    ),
  })

  const {
    funcModal,
    setFuncModal,
    showEncryptionDialog,
    setShowEncryptionDialog,
    handleChipClick,
    handleFuncModalInsert,
  } = useUrlFuncModal({
    divRef,
    skipSyncRef,
    buildHtml,
    onChange,
    activeWorkspaceId,
    insertUrlToken,
  })

  const {
    handleInput,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handlePaste,
    handleKeyDown,
  } = useUrlInputHandlers({
    buildHtml,
    skipSyncRef,
    onChange,
    onSend,
    onQueryParams,
    onImportCommand,
    acOpen,
    acItems,
    acIdx,
    acNsFilter,
    setAcIdx,
    openAutocomplete,
    closeAutocomplete,
    selectUrlItem,
  })

  const { handleMouseDown, handleMouseMove, handleClick } = useUrlMouseHandlers(
    {
      divRef,
      onChipClick: useCallback(
        (target: HTMLElement) => {
          if (target.dataset.param === "true") {
            const name = (target.textContent ?? "").replace(/^:/, "")
            if (name) onParamClick?.(name)
            return
          }
          if (target.dataset.tpl === "var") {
            const varName = target.dataset.var
            if (varName) onVarClick?.(varName)
            return
          }
          if (target.dataset.tpl === "func") handleChipClick(target)
        },
        [onParamClick, onVarClick, handleChipClick],
      ),
    },
  )

  // Sync innerHTML from the value prop (skipped on internal edits via skipSyncRef).
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    if (skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    const html = buildHtml(value)
    if (el.innerHTML !== html) {
      if (document.activeElement === el) {
        const caret = getCaretOffset(el)
        el.innerHTML = html
        ensureTrailingTextNode(el)
        setCaretOffset(el, caret)
      } else {
        el.innerHTML = html
        ensureTrailingTextNode(el)
      }
    } else {
      ensureTrailingTextNode(el)
    }
  }, [value, buildHtml])

  return (
    <>
      <div
        ref={divRef}
        contentEditable={!disabled && !readOnly}
        suppressContentEditableWarning
        onMouseDown={readOnly ? undefined : handleMouseDown}
        onMouseMove={readOnly ? undefined : handleMouseMove}
        onBeforeInput={handleBeforeInput}
        onInput={handleInput}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onFocus={onFocus}
        onBlur={() => {
          onCommit()
          onBlur?.()
        }}
        onKeyDown={handleKeyDown}
        onClick={readOnly ? undefined : handleClick}
        data-placeholder={disabled ? "Select a request" : "https://..."}
        style={{ fontSize: "0.786rem" }}
        className={cn(
          // `min-w-[90px]` keeps the URL legible when the request pane is
          // dragged narrow (instead of collapsing to nothing); `text-ellipsis`
          // trails a … when the text overflows that width.
          "ce-placeholder editor-font flex-1 min-w-[90px] px-2.5 py-[6px] outline-none leading-[1.5] whitespace-nowrap text-ellipsis",
          // Frozen snapshot URL reads muted (like a snapshot's tree-row name);
          // the live editor stays full-contrast.
          readOnly
            ? "overflow-x-auto selectable-text text-muted"
            : "overflow-hidden text-fg",
          disabled && "opacity-40 cursor-not-allowed pointer-events-none",
        )}
      />

      <UrlInputModals
        acOpen={acOpen}
        acItems={acItems}
        acIdx={acIdx}
        acQuery={acQuery}
        anchorRect={anchorRect}
        selectUrlItem={selectUrlItem}
        closeAutocomplete={closeAutocomplete}
        showEncryptionDialog={showEncryptionDialog}
        activeWorkspaceId={activeWorkspaceId}
        setShowEncryptionDialog={setShowEncryptionDialog}
        funcModal={funcModal}
        setFuncModal={setFuncModal}
        fns={fns}
        handleFuncModalInsert={handleFuncModalInsert}
      />
    </>
  )
}
