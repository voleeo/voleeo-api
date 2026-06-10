import type React from "react"
import type { RefObject } from "react"
import { useChipEditableHandlers } from "@/hooks/useChipEditableHandlers"
import {
  displayToStoredOffset,
  ensureTrailingTextNode,
  getCaretOffset,
  setCaretOffset,
} from "@/lib/caret"
import { type CommandImportResult, tryParseCommand } from "@/lib/commandImport"
import { parseQueryString } from "../paramUtils"
import type { AutocompleteItem } from "./useUrlAutocomplete"
import { getUrlPartialExpr } from "./useUrlAutocomplete"

interface UseUrlInputHandlersOptions {
  buildHtml: (text: string) => string
  skipSyncRef: RefObject<boolean>
  onChange: (v: string) => void
  onSend: () => void
  onQueryParams?: (params: Array<{ key: string; value: string }>) => void
  onImportCommand?: (result: CommandImportResult) => void
  acOpen: boolean
  acItems: AutocompleteItem[]
  acIdx: number
  acNsFilter: string | null
  setAcIdx: React.Dispatch<React.SetStateAction<number>>
  openAutocomplete: (
    query: string,
    partialStart: number,
    nsFilter?: string | null,
  ) => void
  closeAutocomplete: () => void
  selectUrlItem: (item: AutocompleteItem) => void
}

export function useUrlInputHandlers({
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
}: UseUrlInputHandlersOptions) {
  const {
    read,
    pushUndo,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handleSharedKeyDown,
  } = useChipEditableHandlers({
    buildHtml,
    skipSyncRef,
    onChange,
    acOpen,
    acItemCount: acItems.length,
    setAcIdx,
    selectActiveItem: () => {
      const item = acItems[acIdx]
      if (item) selectUrlItem(item)
    },
    closeAutocomplete,
  })

  function handleInput(e: React.SyntheticEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const stored = read(el)

    // If the user typed `?`, extract query params and strip them from the URL bar.
    const qDisplayIdx = (el.textContent ?? "").indexOf("?")
    if (qDisplayIdx !== -1) {
      const qStoredIdx = displayToStoredOffset(el, qDisplayIdx)
      const pathStored = stored.slice(0, qStoredIdx)
      const params = parseQueryString(stored.slice(qStoredIdx + 1))
      el.innerHTML = buildHtml(pathStored)
      ensureTrailingTextNode(el)
      setCaretOffset(el, qDisplayIdx)
      skipSyncRef.current = true
      onChange(pathStored)
      onQueryParams?.(params)
      return
    }

    const displayCaret = getCaretOffset(el)
    const html = buildHtml(stored)
    if (el.innerHTML !== html) {
      el.innerHTML = html
      ensureTrailingTextNode(el)
      setCaretOffset(el, displayCaret)
    } else {
      ensureTrailingTextNode(el)
    }
    skipSyncRef.current = true
    onChange(stored)

    const partial = getUrlPartialExpr(el)
    if (partial) {
      openAutocomplete(
        partial.query,
        partial.startOffset,
        partial.isTemplate ? acNsFilter : null,
      )
    } else {
      closeAutocomplete()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = e.currentTarget
    const text = e.clipboardData.getData("text/plain")
    if (!text) return
    // When the input is empty and the paste looks like a curl/httpie command,
    // hand it up to the parent for full request import instead of inserting
    // it as plain text. Disabled commands (no onImportCommand) fall through.
    if (onImportCommand && read(el) === "") {
      const result = tryParseCommand(text)
      if (result) {
        onImportCommand(result)
        return
      }
    }
    pushUndo(el)
    document.execCommand("insertText", false, text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget

    if (e.key === "Enter" && !acOpen) {
      e.preventDefault()
      onSend()
      return
    }

    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault()
      const caret = getCaretOffset(el)
      const partial = getUrlPartialExpr(el)
      openAutocomplete(
        partial?.query ?? "",
        partial?.startOffset ?? caret,
        null,
      )
      return
    }

    handleSharedKeyDown(e)
  }

  return {
    handleInput,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handlePaste,
    handleKeyDown,
  }
}
