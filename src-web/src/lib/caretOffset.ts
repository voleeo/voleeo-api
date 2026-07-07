/**
 * Caret offset primitives for contenteditable elements that contain atomic
 * inline spans (contenteditable="false"). All positions are plain-text
 * character offsets — i.e. the number of characters in the element's
 * textContent, ignoring HTML structure.
 */

/**
 * Ensures the last child of `el` is a text node.  Without this, when the
 * final child is an atomic span there is nowhere for the browser to place the
 * cursor after it, preventing the user from typing at the end of the line.
 */
export function ensureTrailingTextNode(el: HTMLElement): void {
  if (!el.lastChild || el.lastChild.nodeType !== Node.TEXT_NODE) {
    el.appendChild(document.createTextNode(""))
  }
}

/** Returns the caret offset (plain-text character index) inside `el`. */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString().length
}

/**
 * Places the caret at `offset` (plain-text character index) inside `el`.
 *
 * If the offset lands inside a contenteditable=false span the caret is snapped
 * to the span's nearest boundary so the span stays atomic.
 */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node: Node | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard tree-walker loop
  while ((node = walker.nextNode())) {
    const textNode = node as Text
    const len = textNode.length
    const parentEl = textNode.parentElement
    const inAtom =
      parentEl !== null &&
      parentEl !== el &&
      parentEl.getAttribute("contenteditable") === "false"

    if (remaining <= len) {
      if (inAtom && parentEl) {
        const range = document.createRange()
        if (remaining === 0) {
          range.setStartBefore(parentEl)
        } else {
          // Prefer placing the cursor in the next sibling text node so it lives
          // inside a text node rather than at the element boundary.
          const next = parentEl.nextSibling
          if (next?.nodeType === Node.TEXT_NODE) {
            range.setStart(next as Text, 0)
          } else {
            range.setStartAfter(parentEl)
          }
        }
        range.collapse(true)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
        return
      }
      const range = document.createRange()
      range.setStart(textNode, remaining)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
    remaining -= len
  }
  // Offset past end — place at the very end.
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/**
 * Returns the display-character offset of the selection ANCHOR (the fixed end
 * when extending a selection with Shift+Arrow). Falls back to the focus offset
 * for collapsed selections or if the anchor lies outside `el`.
 */
export function getAnchorOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    return getCaretOffset(el)
  }
  const r = document.createRange()
  r.selectNodeContents(el)
  try {
    // biome-ignore lint/style/noNonNullAssertion: anchorNode is always set when a Selection exists
    r.setEnd(sel.anchorNode!, sel.anchorOffset)
  } catch {
    return getCaretOffset(el)
  }
  return r.toString().length
}

/**
 * Returns the display-character offset of the selection FOCUS (the moving end
 * for Shift+Arrow selections; identical to getCaretOffset for collapsed
 * selections).
 */
export function getFocusOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.focusNode)) {
    return getCaretOffset(el)
  }
  const r = document.createRange()
  r.selectNodeContents(el)
  try {
    // biome-ignore lint/style/noNonNullAssertion: focusNode is always set when a Selection exists
    r.setEnd(sel.focusNode!, sel.focusOffset)
  } catch {
    return getCaretOffset(el)
  }
  return r.toString().length
}
