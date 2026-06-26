import { useEffect } from "react"

const SELECTOR = "input, textarea, [contenteditable]"

function disable(el: Element) {
  el.setAttribute("autocomplete", "off")
  el.setAttribute("autocorrect", "off")
  el.setAttribute("autocapitalize", "off")
  el.setAttribute("spellcheck", "false")
}

export function useDisableNativeAutofill() {
  useEffect(() => {
    for (const el of document.querySelectorAll(SELECTOR)) disable(el)
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(SELECTOR)) disable(node)
          for (const el of node.querySelectorAll(SELECTOR)) disable(el)
        }
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])
}
