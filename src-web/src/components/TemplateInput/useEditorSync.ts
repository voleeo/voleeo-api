import type { Ref, RefObject } from "react"
import { useEffect, useLayoutEffect, useRef } from "react"
import {
  attachAtomSnapListener,
  ensureTrailingTextNode,
  getCaretOffset,
  setCaretOffset,
} from "@/lib/caret"

interface UseEditorSyncOptions {
  divRef: RefObject<HTMLDivElement | null>
  value: string
  buildHtml: (text: string) => string
  varStatus: (name: string) => "found" | "missing" | "system"
  forwardedRef: Ref<HTMLDivElement> | undefined
  skipSyncRef: RefObject<boolean>
}

export function useEditorSync({
  divRef,
  value,
  buildHtml,
  varStatus,
  forwardedRef,
  skipSyncRef,
}: UseEditorSyncOptions): void {
  // Use layoutEffect so the forwarded ref is populated before any parent
  // useEffect can read it (e.g. useVariableRows focus-on-open).
  useLayoutEffect(() => {
    if (!forwardedRef) return
    if (typeof forwardedRef === "function") {
      forwardedRef(divRef.current)
    } else {
      ;(forwardedRef as RefObject<HTMLDivElement | null>).current =
        divRef.current
    }
  }, [forwardedRef, divRef])

  useEffect(() => {
    const el = divRef.current
    if (!el) return
    return attachAtomSnapListener(el)
  }, [divRef])

  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    if (skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    const html = buildHtml(value)
    if (el.innerHTML !== html) {
      if (document.activeElement === el) {
        const caret = getCaretOffset(el)
        el.innerHTML = html
        ensureTrailingTextNode(el)
        setCaretOffset(el, caret)
      } else {
        el.innerHTML = html
        ensureTrailingTextNode(el)
      }
    } else {
      ensureTrailingTextNode(el)
    }
  }, [value, buildHtml, divRef, skipSyncRef])

  const prevVarStatusRef = useRef(varStatus)
  useLayoutEffect(() => {
    if (prevVarStatusRef.current === varStatus) return
    prevVarStatusRef.current = varStatus
    const el = divRef.current
    if (!el || document.activeElement === el) return
    el.innerHTML = buildHtml(value)
    ensureTrailingTextNode(el)
  }, [varStatus, buildHtml, value, divRef])
}
