/** Returns the caret pixel rect inside a textarea using a hidden mirror element. */
export function getTextareaCaretRect(textarea: HTMLTextAreaElement): DOMRect {
  const mirror = document.createElement("div")
  const style = window.getComputedStyle(textarea)
  const copyProps = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "width",
    "wordWrap",
    "whiteSpace",
    "overflowWrap",
  ] as const
  for (const prop of copyProps) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop))
  }
  mirror.style.position = "absolute"
  mirror.style.top = "0"
  mirror.style.left = "0"
  mirror.style.visibility = "hidden"
  mirror.style.overflow = "hidden"
  mirror.style.height = "0"
  mirror.style.whiteSpace = "pre-wrap"

  const beforeCaret = textarea.value.slice(0, textarea.selectionStart ?? 0)
  const textNode = document.createTextNode(beforeCaret)
  const caretSpan = document.createElement("span")
  caretSpan.textContent = "|"
  mirror.appendChild(textNode)
  mirror.appendChild(caretSpan)

  document.body.appendChild(mirror)
  const taRect = textarea.getBoundingClientRect()
  const spanRect = caretSpan.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  document.body.removeChild(mirror)

  // The mirror is at (0,0); offset by the textarea's position and scroll.
  const top = taRect.top + (spanRect.top - mirrorRect.top) - textarea.scrollTop
  const left =
    taRect.left + (spanRect.left - mirrorRect.left) - textarea.scrollLeft
  return new DOMRect(left, top, 0, Number.parseFloat(style.lineHeight) || 16)
}
