/**
 * Shared caret-management utilities for contenteditable elements that contain
 * atomic inline spans (contenteditable="false").
 *
 * All positions are expressed as plain-text character offsets — i.e. the
 * number of characters in the element's textContent, ignoring HTML structure.
 * This lets callers work with a simple integer rather than DOM Range objects.
 */
export {
  ensureTrailingTextNode,
  getAnchorOffset,
  getCaretOffset,
  getFocusOffset,
  setCaretOffset,
} from "./caretOffset"
export { attachAtomSnapListener, setSelectionExtended } from "./caretSelection"
export {
  displayToStoredOffset,
  extractStoredValue,
  getChipRanges,
} from "./caretStoredValue"
