import type React from "react"
import type { RefObject } from "react"
import { useRef } from "react"
import { useChipEditableHandlers } from "@/hooks/useChipEditableHandlers"
import {
  displayToStoredOffset,
  ensureTrailingTextNode,
  getCaretOffset,
  setCaretOffset,
} from "@/lib/caret"
import type { AutocompleteItem } from "./Autocomplete"

interface UseInputHandlersOptions {
  buildHtml: (text: string) => string
  skipSyncRef: RefObject<boolean>
  onChange: (v: string) => void
  onCommit?: () => void
  onVarClick?: (varName: string) => void
  multiline?: boolean
  acOpen: boolean
  acItems: AutocompleteItem[]
  acIdx: number
  acNsFilter: string | null
  setAcIdx: React.Dispatch<React.SetStateAction<number>>
  openAutocomplete: (
    query: string,
    partialStart: number,
    nsFilter?: string | null,
    isTemplate?: boolean,
  ) => void
  closeAutocomplete: () => void
  getPartialExpr: (
    el: HTMLElement,
  ) => { query: string; startOffset: number; isTemplate: boolean } | null
  selectItem: (item: AutocompleteItem) => void
  handleChipClick: (target: HTMLElement) => void
}

export function useInputHandlers({
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
}: UseInputHandlersOptions) {
  // Tracks mousedown position to distinguish a drag-select from a pure click.
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)

  const {
    read,
    pushUndo,
    rebuild,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handleSharedKeyDown,
  } = useChipEditableHandlers({
    buildHtml,
    skipSyncRef,
    onChange,
    multiline,
    acOpen,
    acItemCount: acItems.length,
    setAcIdx,
    selectActiveItem: () => {
      const item = acItems[acIdx]
      if (item) selectItem(item)
    },
    closeAutocomplete,
  })

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    mouseDownPos.current = { x: e.clientX, y: e.clientY }
  }

  function handleInput(e: React.SyntheticEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const displayCaret = getCaretOffset(el)
    const stored = read(el)
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

    // Namespace filter only applies within a `{{ }}` context — discard it for
    // plain-word completions so it doesn't bleed across unrelated keystrokes.
    const partial = getPartialExpr(el)
    if (partial) {
      openAutocomplete(
        partial.query,
        partial.startOffset,
        partial.isTemplate ? acNsFilter : null,
        partial.isTemplate,
      )
    } else {
      closeAutocomplete()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = e.currentTarget
    const raw = e.clipboardData.getData("text/plain")
    const text = multiline
      ? raw.replace(/\r\n?/g, "\n")
      : raw.replace(/[\r\n]+/g, "")
    if (!text) return
    pushUndo(el)
    document.execCommand("insertText", false, text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget

    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault()
      const caret = getCaretOffset(el)
      const partial = getPartialExpr(el)
      openAutocomplete(
        partial?.query ?? "",
        partial?.startOffset ?? caret,
        null,
        partial?.isTemplate ?? false,
      )
      return
    }

    if (handleSharedKeyDown(e)) return

    if (e.key === "Escape") {
      closeAutocomplete()
      return
    }

    if (e.key === "Enter") {
      // acOpen Enter was already consumed by handleSharedKeyDown.
      if (multiline && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        pushUndo(el)
        const stored = read(el)
        const displayCaret = getCaretOffset(el)
        const storedCaret = displayToStoredOffset(el, displayCaret)
        const newStored = `${stored.slice(0, storedCaret)}\n${stored.slice(storedCaret)}`
        rebuild(el, newStored, displayCaret + 1)
        return
      }
      e.preventDefault()
      onCommit?.()
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.tagName !== "SPAN") return
    // If the mouse moved more than 4 px between mousedown and click, the user
    // was drag-selecting — preserve the selection and don't open any modal.
    const down = mouseDownPos.current
    if (down) {
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      if (dx * dx + dy * dy > 16) return
    }
    if (target.dataset.tpl === "var") {
      onVarClick?.(target.dataset.var ?? "")
      return
    }
    if (target.dataset.tpl === "func") {
      handleChipClick(target)
    }
  }

  return {
    handleInput,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handlePaste,
    handleKeyDown,
    handleClick,
    handleMouseDown,
  }
}
