/**
 * Conversions between the DOM representation of a chip-editable element and
 * the stored template string it represents.
 */
import { serializeFuncToken } from "./template"

/**
 * Reconstructs the stored template string from the DOM contents of a
 * contenteditable element that may contain atomic chip spans.
 *
 * - Plain text nodes → appended as-is.
 * - `data-tpl="var"` spans → `{{ VAR_NAME }}` (name read from `data-var`).
 * - `data-tpl="func"` spans → `{{ func(args) }}` (from `data-func`/`data-args`
 *   when present, or from `textContent` otherwise — the UrlInput path).
 * - `data-param="true"` spans → `textContent` as-is (`:paramName` is
 *   already the stored form).
 * - Any other element → `textContent`.
 */
export function extractStoredValue(
  el: HTMLElement,
  opts?: { multiline?: boolean },
): string {
  let result = ""
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? ""
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const span = node as HTMLElement
      const tpl = span.dataset.tpl
      if (tpl === "var") {
        const name = span.dataset.var ?? span.textContent ?? ""
        result += `{{ ${name} }}`
      } else if (tpl === "func") {
        if (span.dataset.func !== undefined) {
          // TemplateInput path: data-func + data-args are set.
          const fnName = span.dataset.func
          let args: Record<string, string> = {}
          try {
            args = JSON.parse(span.dataset.args ?? "{}")
          } catch {
            // ignore parse errors
          }
          result += serializeFuncToken(fnName, args)
        } else {
          // UrlInput path: only textContent available.
          const inner = (span.textContent ?? "").trim()
          result += `{{ ${inner} }}`
        }
      } else {
        // data-param="true" or unknown chip — textContent is the stored form.
        result += span.textContent ?? ""
      }
    }
  }
  // Single-line callers strip newlines to keep request fields clean
  // (URL, headers, params, auth). Multiline callers (e.g. cookie value)
  // opt in to preserving them — but still strip the U+200B phantom we
  // append in multiline mode so trailing newlines render a visible line.
  return opts?.multiline
    ? result.replace(/​/g, "")
    : result.replace(/[\r\n]/g, "")
}

/**
 * Maps a display-character offset (the same coordinate used by
 * `getCaretOffset` / `setCaretOffset`) to the corresponding offset in the
 * stored template string produced by `extractStoredValue`.
 *
 * Display chars count chip text (e.g. `AUTH_HOST` = 9 chars).
 * Stored chars count the full chip token (e.g. `{{ AUTH_HOST }}` = 15 chars).
 *
 * Positions inside a chip snap to just after the chip in stored space,
 * mirroring the atomic-block caret behaviour.
 */
export function displayToStoredOffset(
  el: HTMLElement,
  displayOffset: number,
): number {
  let storedPos = 0
  let displayPos = 0

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? "").length
      if (displayPos + len >= displayOffset) {
        return storedPos + (displayOffset - displayPos)
      }
      storedPos += len
      displayPos += len
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const span = node as HTMLElement
      const displayLen = (span.textContent ?? "").length
      const tpl = span.dataset.tpl

      let storedLen: number
      if (tpl === "var") {
        const name = span.dataset.var ?? span.textContent ?? ""
        storedLen = `{{ ${name} }}`.length
      } else if (tpl === "func") {
        if (span.dataset.func !== undefined) {
          const fnName = span.dataset.func
          let args: Record<string, string> = {}
          try {
            args = JSON.parse(span.dataset.args ?? "{}")
          } catch {}
          storedLen = serializeFuncToken(fnName, args).length
        } else {
          const inner = (span.textContent ?? "").trim()
          storedLen = `{{ ${inner} }}`.length
        }
      } else {
        // param chip: display == stored
        storedLen = displayLen
      }

      if (displayOffset <= displayPos) {
        return storedPos
      }
      if (displayOffset <= displayPos + displayLen) {
        // Inside or at the end of this chip — snap to after it.
        return storedPos + storedLen
      }
      storedPos += storedLen
      displayPos += displayLen
    }
  }

  return storedPos
}

/**
 * Returns the display-character ranges `[start, end)` of all
 * `contenteditable="false"` chip spans inside `el`, in source order.
 *
 * Positions are in the same plain-text coordinate system as
 * `getCaretOffset` / `setCaretOffset`.  Use these ranges in arrow-key
 * handlers to snap the caret past chips as a single character.
 */
export function getChipRanges(
  el: HTMLElement,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let pos = 0
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      pos += (node.textContent ?? "").length
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const span = node as HTMLElement
      const len = (span.textContent ?? "").length
      if (span.getAttribute("contenteditable") === "false") {
        ranges.push({ start: pos, end: pos + len })
      }
      pos += len
    }
  }
  return ranges
}
