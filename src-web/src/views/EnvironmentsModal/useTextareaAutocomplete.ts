import type React from "react"
import type { RefObject } from "react"
import { useState } from "react"
import {
  type AutocompleteItem,
  buildItems,
} from "@/components/TemplateInput/Autocomplete"
import { serialize } from "@/lib/template"
import { getTextareaCaretRect } from "@/lib/textareaCaretRect"
import type { BoundTemplateFunction } from "@/plugins/types"

interface UseTextareaAutocompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  varKeys: string[]
  fns: BoundTemplateFunction[]
  setText: (v: string) => void
}

/** `{{ }}` autocomplete state machine for the plain-textarea environment editor. */
export function useTextareaAutocomplete({
  textareaRef,
  varKeys,
  fns,
  setText,
}: UseTextareaAutocompleteOptions) {
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([])
  const [acIdx, setAcIdx] = useState(0)
  const [acOpen, setAcOpen] = useState(false)
  const [acPartialStart, setAcPartialStart] = useState(0)
  const [acNsFilter, setAcNsFilter] = useState<string | null>(null)
  const [acQuery, setAcQuery] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  function getPartialExpr(
    val: string,
    caretPos: number,
  ): { query: string; startPos: number } | null {
    const before = val.slice(0, caretPos)
    const openIdx = before.lastIndexOf("{{")
    if (openIdx === -1 || before.slice(openIdx).includes("}}")) return null
    const query = before.slice(openIdx + 2).trimStart()
    return { query, startPos: openIdx }
  }

  function openAutocomplete(
    query: string,
    partialStart: number,
    nsFilter: string | null = null,
  ) {
    const ta = textareaRef.current
    if (!ta) return
    setAnchorRect(getTextareaCaretRect(ta))
    const items = buildItems(query, varKeys, fns, nsFilter)
    setAcItems(items)
    setAcIdx(0)
    setAcPartialStart(partialStart)
    setAcNsFilter(nsFilter)
    setAcQuery(query)
    setAcOpen(items.length > 0)
  }

  function closeAutocomplete() {
    setAcOpen(false)
    setAcNsFilter(null)
    setAcQuery("")
  }

  function insertToken(storedToken: string) {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? 0
    const newText =
      ta.value.slice(0, acPartialStart) + storedToken + ta.value.slice(caret)
    setText(newText)
    const newCaret = acPartialStart + storedToken.length
    // requestAnimationFrame so the state update flushes before we set the caret.
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCaret, newCaret)
      ta.focus()
    })
    closeAutocomplete()
  }

  function selectItem(item: AutocompleteItem) {
    if (item.kind === "namespace") {
      // Narrow the list to this namespace without inserting a finished token.
      const ta = textareaRef.current
      if (!ta) return
      const caret = ta.selectionStart ?? 0
      const insertText = `{{ ${item.prefix}.`
      const newText =
        ta.value.slice(0, acPartialStart) + insertText + ta.value.slice(caret)
      setText(newText)
      const newCaret = acPartialStart + insertText.length
      requestAnimationFrame(() => {
        ta.setSelectionRange(newCaret, newCaret)
        ta.focus()
      })
      openAutocomplete("", acPartialStart, item.prefix)
      return
    }
    if (item.kind === "var") {
      insertToken(serialize([{ kind: "var", name: item.name }]))
      return
    }
    // func — insert immediately (no modal in text view; edit the text directly).
    if (item.kind !== "func") return
    const argStr = (item.fn.args ?? [])
      .map((a) => `${a.name}="${a.defaultValue ?? ""}"`)
      .join(", ")
    insertToken(
      argStr ? `{{ ${item.fn.name}(${argStr}) }}` : `{{ ${item.fn.name}() }}`,
    )
  }

  /** Re-evaluates the partial expression at the caret after a text change. */
  function syncFromCaret(val: string, caret: number) {
    const partial = getPartialExpr(val, caret)
    if (partial) {
      const dotIdx = partial.query.indexOf(".")
      const nsFilter =
        acNsFilter ?? (dotIdx !== -1 ? partial.query.slice(0, dotIdx) : null)
      openAutocomplete(partial.query, partial.startPos, nsFilter)
    } else {
      closeAutocomplete()
    }
  }

  /** Returns true if the keydown was consumed by autocomplete. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault()
      const ta = e.currentTarget
      const caret = ta.selectionStart ?? 0
      const partial = getPartialExpr(ta.value, caret)
      openAutocomplete(partial?.query ?? "", partial?.startPos ?? caret, null)
      return true
    }

    if (!acOpen) return false

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setAcIdx((i) => Math.min(i + 1, acItems.length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setAcIdx((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault()
      const item = acItems[acIdx]
      if (item) selectItem(item)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      closeAutocomplete()
      return true
    }
    return false
  }

  return {
    acOpen,
    acItems,
    acIdx,
    acQuery,
    anchorRect,
    selectItem,
    closeAutocomplete,
    syncFromCaret,
    handleKeyDown,
  }
}
