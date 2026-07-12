import type { RefObject } from "react"
import { useState } from "react"
import {
  displayToStoredOffset,
  ensureTrailingTextNode,
  extractStoredValue,
  getCaretOffset,
  getChipRanges,
  setCaretOffset,
} from "@/lib/caret"
import { parseExpr, serialize } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { AutocompleteItem, ConstantSuggestion } from "./Autocomplete"
import { Autocomplete, buildItems } from "./Autocomplete"
import type { ActiveVar } from "./useTemplateInputData"

export type { AutocompleteItem }
export { Autocomplete }

function storedTokenDisplayLen(storedToken: string): number {
  if (!storedToken.startsWith("{{ ") || !storedToken.endsWith(" }}")) {
    return storedToken.length
  }
  const inner = storedToken.slice(3, -3).trim()
  const tok = parseExpr(inner)
  if (!tok || tok.kind === "plain") return storedToken.length - 6
  if (tok.kind === "var") return tok.name.length
  return tok.name.length + (Object.keys(tok.args).length > 0 ? 5 : 2)
}

interface UseAutocompleteOptions {
  divRef: RefObject<HTMLDivElement | null>
  activeVars: ActiveVar[]
  fns: BoundTemplateFunction[]
  excludeVarKeys?: string[]
  multiline?: boolean
  buildHtml: (text: string) => string
  skipSyncRef: RefObject<boolean>
  onChange: (v: string) => void
  onFuncSelect: (
    fn: BoundTemplateFunction,
    insertStart: number,
    insertEnd: number,
  ) => void
  constantItems?: ConstantSuggestion[]
  onConstantSelect?: (value: string) => void
}

export interface UseAutocompleteResult {
  acOpen: boolean
  acItems: AutocompleteItem[]
  acIdx: number
  acNsFilter: string | null
  acQuery: string
  anchorRect: DOMRect | null
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
  insertToken: (
    storedToken: string,
    fromDisplay: number,
    toDisplay: number,
  ) => void
  selectItem: (item: AutocompleteItem) => void
}

export function useAutocomplete({
  divRef,
  activeVars,
  fns,
  excludeVarKeys,
  multiline,
  buildHtml,
  skipSyncRef,
  onChange,
  onFuncSelect,
  constantItems,
  onConstantSelect,
}: UseAutocompleteOptions): UseAutocompleteResult {
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([])
  const [acIdx, setAcIdx] = useState(0)
  const [acOpen, setAcOpen] = useState(false)
  const [acPartialStart, setAcPartialStart] = useState(0)
  const [acNsFilter, setAcNsFilter] = useState<string | null>(null)
  const [acQuery, setAcQuery] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  function openAutocomplete(
    query: string,
    partialStart: number,
    nsFilter: string | null = null,
    isTemplate = false,
  ) {
    const el = divRef.current
    if (!el) return
    const varKeys = activeVars
      .map((v) => ({ name: v.key, system: v.system }))
      .filter((v) => !excludeVarKeys?.includes(v.name))
    // Constants are only shown in plain (non-template, non-namespace) context.
    const constants = isTemplate || nsFilter ? undefined : constantItems
    const items = buildItems(query, varKeys, fns, nsFilter, constants)
    setAnchorRect(el.getBoundingClientRect())
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

  function getPartialExpr(
    el: HTMLElement,
  ): { query: string; startOffset: number; isTemplate: boolean } | null {
    const plain = el.textContent ?? ""
    const caret = getCaretOffset(el)
    const before = plain.slice(0, caret)

    // Only consider text after the last chip boundary so chip display text
    // doesn't bleed into the word match.
    const chips = getChipRanges(el)
    const lastChipEnd = chips.reduce(
      (acc, c) => (c.end <= caret ? Math.max(acc, c.end) : acc),
      0,
    )
    const plainBefore = before.slice(lastChipEnd)

    const openIdx = plainBefore.lastIndexOf("{{")
    if (openIdx !== -1 && !plainBefore.slice(openIdx).includes("}}")) {
      return {
        query: plainBefore.slice(openIdx + 2).trimStart(),
        startOffset: lastChipEnd + openIdx,
        isTemplate: true,
      }
    }

    const wordMatch = plainBefore.match(/([a-zA-Z0-9_.]+)$/)
    if (!wordMatch) return null
    return {
      query: wordMatch[1],
      startOffset: caret - wordMatch[1].length,
      isTemplate: false,
    }
  }

  function insertToken(
    storedToken: string,
    fromDisplay: number,
    toDisplay: number,
  ) {
    const el = divRef.current
    if (!el) return
    const stored = extractStoredValue(el, { multiline })
    const storedStart = displayToStoredOffset(el, fromDisplay)
    const storedEnd = displayToStoredOffset(el, toDisplay)
    const newStored =
      stored.slice(0, storedStart) + storedToken + stored.slice(storedEnd)
    el.innerHTML = buildHtml(newStored)
    ensureTrailingTextNode(el)
    setCaretOffset(el, fromDisplay + storedTokenDisplayLen(storedToken))
    skipSyncRef.current = true
    onChange(newStored)
    closeAutocomplete()
  }

  function selectItem(item: AutocompleteItem) {
    if (item.kind === "constant") {
      // Insert the literal value, replacing the typed partial expression.
      const el = divRef.current
      if (!el) return
      insertToken(item.value, acPartialStart, getCaretOffset(el))
      onConstantSelect?.(item.value)
      return
    }

    if (item.kind === "namespace") {
      // Expand the namespace prefix in the field, then re-open filtered.
      const el = divRef.current
      if (!el) return
      const plain = el.textContent ?? ""
      const displayCaret = getCaretOffset(el)
      const stored = extractStoredValue(el, { multiline })
      const storedStart = displayToStoredOffset(el, acPartialStart)
      const storedCaret = displayToStoredOffset(el, displayCaret)
      const isTemplate =
        plain.slice(acPartialStart, acPartialStart + 2) === "{{"
      const insertText = isTemplate ? `{{ ${item.prefix}.` : `${item.prefix}.`
      const newStored =
        stored.slice(0, storedStart) + insertText + stored.slice(storedCaret)
      el.innerHTML = buildHtml(newStored)
      ensureTrailingTextNode(el)
      setCaretOffset(el, acPartialStart + insertText.length)
      skipSyncRef.current = true
      onChange(newStored)
      openAutocomplete("", acPartialStart, item.prefix)
      return
    }

    if (item.kind === "var") {
      insertToken(
        serialize([{ kind: "var", name: item.name }]),
        acPartialStart,
        // biome-ignore lint/style/noNonNullAssertion: divRef.current is always set when autocomplete is active
        getCaretOffset(divRef.current!),
      )
      return
    }

    // Schema items are never produced here (buildItems doesn't emit them).
    if (item.kind !== "func") return
    // func — delegate to caller (modal vs. encryption dialog decision)
    const el = divRef.current
    if (!el) return
    const insertEnd = getCaretOffset(el)
    closeAutocomplete()
    onFuncSelect(item.fn, acPartialStart, insertEnd)
  }

  return {
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
  }
}
