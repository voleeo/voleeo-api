/**
 * Sets a (possibly non-collapsed) selection from `anchorDisplay` to
 * `focusDisplay`, both as plain-text character offsets.
 * When they are equal the selection is collapsed (same as setCaretOffset).
 */
export function setSelectionExtended(
  el: HTMLElement,
  anchorDisplay: number,
  focusDisplay: number,
): void {
  const anchor = resolveDisplayOffset(el, anchorDisplay)
  const focus = resolveDisplayOffset(el, focusDisplay)
  if (!anchor || !focus) return
  window
    .getSelection()
    ?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
}

/**
 * Maps a plain-text display offset to a `{ node, offset }` DOM position.
 * Positions exactly at a chip boundary are placed just before (start) or just
 * after (end) the chip span so the caller can distinguish the two sides.
 * Positions are expected to be at chip boundaries or in plain text — i.e.
 * never inside an atomic span.
 */
function resolveDisplayOffset(
  el: HTMLElement,
  displayOffset: number,
): { node: Node; offset: number } | null {
  let pos = 0
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child as Text
      const end = pos + text.length
      if (displayOffset <= end) {
        return { node: text, offset: displayOffset - pos }
      }
      pos = end
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const span = child as HTMLElement
      const spanLen = (span.textContent ?? "").length
      if (displayOffset === pos) {
        // Just before this span — use end of preceding text node.
        const prev = span.previousSibling
        if (prev?.nodeType === Node.TEXT_NODE) {
          return { node: prev as Text, offset: (prev as Text).length }
        }
        return { node: el, offset: i }
      }
      if (displayOffset === pos + spanLen) {
        // Just after this span — use start of following text node.
        const next = span.nextSibling
        if (next?.nodeType === Node.TEXT_NODE) {
          return { node: next as Text, offset: 0 }
        }
        return { node: el, offset: i + 1 }
      }
      pos += spanLen
    }
  }
  // Past end — place at end of last text node.
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const n = el.childNodes[i]
    if (n.nodeType === Node.TEXT_NODE) {
      return { node: n as Text, offset: (n as Text).length }
    }
  }
  return { node: el, offset: el.childNodes.length }
}

/**
 * Attaches a `selectionchange` listener that snaps the cursor out of atomic
 * spans whenever the user clicks or arrow-keys into one.
 *
 * `isDragging` (optional ref) should be set to `true` from a native mousedown
 * listener and cleared on mouseup.  When a drag is in progress, the snap
 * always moves the cursor to just BEFORE the chip — this ensures that dragging
 * rightward from a chip includes it in the selection.  Without the flag the
 * snap is nearest-boundary (before if cursor is in the left half, after if
 * in the right half).
 *
 * Returns a cleanup function — call it in an effect's return to remove the
 * listener when the component unmounts.
 */
export function attachAtomSnapListener(
  el: HTMLElement,
  opts?: { isDragging?: { current: boolean } },
): () => void {
  function onSelectionChange() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.startContainer)) return

    let node: Node | null = range.startContainer
    while (node && node !== el) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).getAttribute("contenteditable") === "false"
      ) {
        const textLen = (node as Element).textContent?.length ?? 1
        const newRange = document.createRange()
        // During a pointer drag always snap before the chip so that
        // dragging rightward from it includes the chip in the selection.
        const snapBefore =
          (opts?.isDragging?.current ?? false) ||
          range.startOffset < textLen / 2
        if (snapBefore) {
          newRange.setStartBefore(node)
        } else {
          const next = (node as Element).nextSibling
          if (next?.nodeType === Node.TEXT_NODE) {
            newRange.setStart(next as Text, 0)
          } else {
            newRange.setStartAfter(node)
          }
        }
        newRange.collapse(true)
        sel.removeAllRanges()
        sel.addRange(newRange)
        return
      }
      node = node.parentNode
    }
  }

  document.addEventListener("selectionchange", onSelectionChange)
  return () =>
    document.removeEventListener("selectionchange", onSelectionChange)
}
