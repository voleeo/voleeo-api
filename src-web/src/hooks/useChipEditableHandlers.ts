import type React from "react"
import type { RefObject } from "react"
import { useRef } from "react"
import {
  displayToStoredOffset,
  ensureTrailingTextNode,
  extractStoredValue,
  getAnchorOffset,
  getCaretOffset,
  getChipRanges,
  getFocusOffset,
  setCaretOffset,
  setSelectionExtended,
} from "@/lib/caret"

interface UseChipEditableHandlersOptions {
  buildHtml: (text: string) => string
  skipSyncRef: RefObject<boolean>
  onChange: (v: string) => void
  /** Multiline editors preserve trailing newlines / zero-width markers. */
  multiline?: boolean
  acOpen: boolean
  acItemCount: number
  setAcIdx: React.Dispatch<React.SetStateAction<number>>
  /** Inserts the currently-highlighted item (Enter/Tab while open). */
  selectActiveItem: () => void
  closeAutocomplete: () => void
}

/**
 * Shared contenteditable chip-editor primitives for TemplateInput and UrlInput;
 * each consumer composes these with its own input/Enter/paste behavior.
 * Invariant: stored value comes only from extractStoredValue — never
 * el.textContent (chip display text differs).
 */
export function useChipEditableHandlers({
  buildHtml,
  skipSyncRef,
  onChange,
  multiline,
  acOpen,
  acItemCount,
  setAcIdx,
  selectActiveItem,
  closeAutocomplete,
}: UseChipEditableHandlersOptions) {
  const undoStack = useRef<Array<{ value: string; caret: number }>>([])
  const redoStack = useRef<Array<{ value: string; caret: number }>>([])

  const read = (el: HTMLElement) => extractStoredValue(el, { multiline })

  function pushUndo(el: HTMLElement) {
    const value = read(el)
    const caret = getCaretOffset(el)
    const last = undoStack.current[undoStack.current.length - 1]
    if (last?.value === value) return
    undoStack.current.push({ value, caret })
    if (undoStack.current.length > 100) undoStack.current.shift()
    redoStack.current = []
  }

  /** Replaces innerHTML from a new stored value, restores caret, syncs React. */
  function rebuild(el: HTMLElement, newStored: string, caret: number) {
    el.innerHTML = buildHtml(newStored)
    ensureTrailingTextNode(el)
    setCaretOffset(el, caret)
    skipSyncRef.current = true
    onChange(newStored)
    closeAutocomplete()
  }

  function handleBeforeInput(e: React.FormEvent<HTMLDivElement>) {
    // Skip browser undo/redo events — we maintain our own stack.
    const t = (e.nativeEvent as InputEvent).inputType
    if (t === "historyUndo" || t === "historyRedo") return
    pushUndo(e.currentTarget as HTMLElement)
  }

  function selectionStored(el: HTMLElement): string {
    const stored = read(el)
    const selStart = Math.min(getAnchorOffset(el), getFocusOffset(el))
    const selEnd = Math.max(getAnchorOffset(el), getFocusOffset(el))
    return stored.slice(
      displayToStoredOffset(el, selStart),
      displayToStoredOffset(el, selEnd),
    )
  }

  /** Copies the stored form of the selection so chips survive copy-paste. */
  function handleCopy(e: React.ClipboardEvent<HTMLDivElement>) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    e.preventDefault()
    e.clipboardData.setData("text/plain", selectionStored(e.currentTarget))
  }

  /** Same as handleCopy but deletes the selection via execCommand so the
   *  removal is tracked (handleInput fires and updates React state). */
  function handleCut(e: React.ClipboardEvent<HTMLDivElement>) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const el = e.currentTarget
    e.preventDefault()
    e.clipboardData.setData("text/plain", selectionStored(el))
    pushUndo(el)
    document.execCommand("delete")
  }

  /** Whole-chip deletion when caret sits inside a chip. Returns true if it
   *  handled the key. WebKit can't reliably backspace into a
   *  contenteditable="false" span between two adjacent chips, so we splice
   *  the stored value ourselves. */
  function deleteChipAt(el: HTMLElement, forward: boolean): boolean {
    const caret = getCaretOffset(el)
    for (const chip of getChipRanges(el)) {
      const hit = forward
        ? caret >= chip.start && caret < chip.end
        : caret > chip.start && caret <= chip.end
      if (!hit) continue
      pushUndo(el)
      const stored = read(el)
      const newStored =
        stored.slice(0, displayToStoredOffset(el, chip.start)) +
        stored.slice(displayToStoredOffset(el, chip.end))
      rebuild(el, newStored, chip.start)
      return true
    }
    return false
  }

  // Arrow / Shift+Arrow snapping: chips behave as a single character — plain
  // arrows move the caret across a chip, Shift extends the selection across it.
  function arrowSnap(
    el: HTMLElement,
    key: "ArrowLeft" | "ArrowRight",
    shift: boolean,
  ): boolean {
    const chips = getChipRanges(el)
    const totalLen = (el.textContent ?? "").length

    if (!shift) {
      const caret = getCaretOffset(el)
      if (key === "ArrowLeft" && caret > 0) {
        const chip = chips.find((c) => caret > c.start && caret <= c.end)
        if (chip) {
          setCaretOffset(el, chip.start)
          return true
        }
      }
      if (key === "ArrowRight" && caret < totalLen) {
        const chip = chips.find((c) => caret >= c.start && caret < c.end)
        if (chip) {
          setCaretOffset(el, chip.end)
          return true
        }
      }
      return false
    }

    const focus = getFocusOffset(el)
    const anchor = getAnchorOffset(el)
    if (key === "ArrowRight" && focus < totalLen) {
      let newFocus = focus + 1
      const chip = chips.find((c) => newFocus >= c.start && newFocus < c.end)
      if (chip) newFocus = chip.end
      setSelectionExtended(el, anchor, newFocus)
      return true
    }
    if (key === "ArrowLeft" && focus > 0) {
      let newFocus = focus - 1
      const chip = chips.find((c) => newFocus > c.start && newFocus <= c.end)
      if (chip) newFocus = chip.start
      setSelectionExtended(el, anchor, newFocus)
      return true
    }
    return false
  }

  // Keys shared by every chip editor: undo/redo, whole-chip Backspace/Delete,
  // open-autocomplete navigation, arrow/shift-arrow snapping. Returns true when
  // consumed. Consumers handle their own Enter/Ctrl+Space/Tab before calling.
  function handleSharedKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
  ): boolean {
    const el = e.currentTarget
    const mod = e.metaKey || e.ctrlKey
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey

    if (mod && e.key === "z") {
      e.preventDefault()
      const [from, to] = e.shiftKey
        ? [redoStack.current, undoStack.current]
        : [undoStack.current, redoStack.current]
      const state = from.pop()
      if (!state) return true
      to.push({ value: read(el), caret: getCaretOffset(el) })
      rebuild(el, state.value, state.caret)
      return true
    }

    if (e.key === "Backspace" && plain && deleteChipAt(el, false)) {
      e.preventDefault()
      return true
    }
    if (e.key === "Delete" && plain && deleteChipAt(el, true)) {
      e.preventDefault()
      return true
    }

    if (acOpen) {
      const consume = (fn: () => void) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
        return true
      }
      if (e.key === "ArrowDown")
        return consume(() => setAcIdx((i) => Math.min(i + 1, acItemCount - 1)))
      if (e.key === "ArrowUp")
        return consume(() => setAcIdx((i) => Math.max(i - 1, 0)))
      if (e.key === "Enter" || e.key === "Tab") return consume(selectActiveItem)
      if (e.key === "Escape") return consume(closeAutocomplete)
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        closeAutocomplete() // fall through to atom-snap below
      }
    }

    if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      !e.ctrlKey &&
      !e.metaKey &&
      arrowSnap(el, e.key, e.shiftKey)
    ) {
      e.preventDefault()
      return true
    }

    return false
  }

  return {
    read,
    pushUndo,
    rebuild,
    handleBeforeInput,
    handleCopy,
    handleCut,
    handleSharedKeyDown,
  }
}
