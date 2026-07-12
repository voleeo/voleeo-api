import type { RefObject } from "react"
import { useRef, useState } from "react"
import type { AutocompleteItem } from "@/components/TemplateInput/Autocomplete"
import {
  Autocomplete,
  buildItems,
} from "@/components/TemplateInput/Autocomplete"
import type { ActiveVar } from "@/components/TemplateInput/useTemplateInputData"
import {
  displayToStoredOffset,
  ensureTrailingTextNode,
  extractStoredValue,
  getCaretOffset,
  getChipRanges,
  setCaretOffset,
} from "@/lib/caret"
import { serialize } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"

export type { AutocompleteItem }
export { Autocomplete }

/**
 * Returns the autocomplete context at the caret position, chip-aware.
 * Chip display text does NOT bleed into the word match.
 */
export function getUrlPartialExpr(
  el: HTMLElement,
): { query: string; startOffset: number; isTemplate: boolean } | null {
  const plain = el.textContent ?? ""
  const caret = getCaretOffset(el)
  const before = plain.slice(0, caret)

  const chips = getChipRanges(el)
  const lastChipEnd = chips.reduce(
    (acc, c) => (c.end <= caret ? Math.max(acc, c.end) : acc),
    0,
  )
  const plainBefore = before.slice(lastChipEnd)

  // Template mode: caret is inside an open {{ … expression.
  const openIdx = plainBefore.lastIndexOf("{{")
  if (openIdx !== -1 && !plainBefore.slice(openIdx).includes("}}")) {
    return {
      query: plainBefore.slice(openIdx + 2).trimStart(),
      startOffset: lastChipEnd + openIdx,
      isTemplate: true,
    }
  }

  // Word mode: last run of identifier chars before the caret.
  // Deliberately excludes URL-syntax chars (/, :, ?, &) to stay quiet
  // while the user edits a plain URL path.
  const wordMatch = plainBefore.match(/([a-zA-Z0-9_.]+)$/)
  if (!wordMatch) return null
  return {
    query: wordMatch[1],
    startOffset: caret - wordMatch[1].length,
    isTemplate: false,
  }
}

export interface UseUrlAutocompleteResult {
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
  ) => void
  closeAutocomplete: () => void
  insertUrlToken: (storedToken: string) => void
  selectUrlItem: (item: AutocompleteItem) => void
}

interface UseUrlAutocompleteOptions {
  divRef: RefObject<HTMLDivElement | null>
  activeVars: ActiveVar[]
  fns: BoundTemplateFunction[]
  buildHtml: (text: string) => string
  skipSyncRef: RefObject<boolean>
  onChange: (v: string) => void
  /** Called when the user selects a func item; caller decides modal vs. dialog. */
  onFuncSelect: (fn: BoundTemplateFunction) => void
}

export function useUrlAutocomplete({
  divRef,
  activeVars,
  fns,
  buildHtml,
  skipSyncRef,
  onChange,
  onFuncSelect,
}: UseUrlAutocompleteOptions): UseUrlAutocompleteResult {
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([])
  const [acIdx, setAcIdx] = useState(0)
  const [acOpen, setAcOpen] = useState(false)
  const [acPartialStart, setAcPartialStart] = useState(0)
  const [acNsFilter, setAcNsFilter] = useState<string | null>(null)
  const [acQuery, setAcQuery] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const pendingEndRef = useRef<number | null>(null)

  function openAutocomplete(
    query: string,
    partialStart: number,
    nsFilter: string | null = null,
  ) {
    const el = divRef.current
    if (!el) return
    setAnchorRect(el.getBoundingClientRect())
    const items = buildItems(
      query,
      activeVars.map((v) => ({ name: v.key, system: v.system })),
      fns,
      nsFilter,
    )
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

  function insertUrlToken(storedToken: string) {
    const el = divRef.current
    if (!el) return
    const displayCaret = pendingEndRef.current ?? getCaretOffset(el)
    pendingEndRef.current = null
    const stored = extractStoredValue(el)
    const storedStart = displayToStoredOffset(el, acPartialStart)
    const storedCaret = displayToStoredOffset(el, displayCaret)
    const newStored =
      stored.slice(0, storedStart) + storedToken + stored.slice(storedCaret)
    el.innerHTML = buildHtml(newStored)
    ensureTrailingTextNode(el)
    // Chips display without {{ }} so display length = stored length − 6.
    const displayLen =
      storedToken.startsWith("{{ ") && storedToken.endsWith(" }}")
        ? storedToken.length - 6
        : storedToken.length
    setCaretOffset(el, acPartialStart + displayLen)
    skipSyncRef.current = true
    onChange(newStored)
    closeAutocomplete()
  }

  function selectUrlItem(item: AutocompleteItem) {
    if (item.kind === "namespace") {
      const el = divRef.current
      if (!el) return
      const plain = el.textContent ?? ""
      const displayCaret = getCaretOffset(el)
      const stored = extractStoredValue(el)
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
      insertUrlToken(serialize([{ kind: "var", name: item.name }]))
      return
    }

    if (item.kind !== "func") return
    const el = divRef.current
    if (el) pendingEndRef.current = getCaretOffset(el)
    closeAutocomplete()
    onFuncSelect(item.fn)
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
    insertUrlToken,
    selectUrlItem,
  }
}
