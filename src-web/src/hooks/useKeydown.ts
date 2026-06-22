import { useEffect } from "react"
import { isMac } from "@/lib/platform"

export interface KeyCombo {
  key: string // e.g. "n", "k", "/"
  meta?: boolean // primary modifier: Cmd on macOS, Ctrl on Windows/Linux
  ctrl?: boolean // literal Ctrl on every platform
  shift?: boolean
  alt?: boolean
}

/** The modifier fields read by the combo matcher — satisfied by both native
 *  `KeyboardEvent` and React's `KeyboardEvent`. */
type ModifierEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>

/**
 * True when `e` matches `combo`. `meta` is the primary modifier and maps to the
 * platform default — Cmd on macOS, Ctrl on Windows/Linux (mirrors Tauri's
 * `CmdOrCtrl`). `ctrl` is always literal Ctrl. The macOS Cmd / Windows Super key
 * is never required outside macOS, so meta-only shortcuts work everywhere.
 */
export function matchesCombo(e: ModifierEvent, combo: KeyCombo): boolean {
  const wantMeta = isMac ? !!combo.meta : false
  const wantCtrl = isMac ? !!combo.ctrl : !!combo.meta || !!combo.ctrl
  return (
    keyMatches(e, combo.key) &&
    e.metaKey === wantMeta &&
    e.ctrlKey === wantCtrl &&
    e.shiftKey === !!combo.shift &&
    e.altKey === !!combo.alt
  )
}

function keyToCode(key: string): string {
  if (key.length === 1 && key >= "a" && key <= "z") {
    return `Key${key.toUpperCase()}`
  }
  if (key.length === 1 && key >= "0" && key <= "9") return `Digit${key}`
  switch (key) {
    case "/":
      return "Slash"
    case "\\":
      return "Backslash"
    case "enter":
      return "Enter"
    default:
      return ""
  }
}

function keyMatches(e: ModifierEvent, key: string): boolean {
  const k = key.toLowerCase()
  if (e.key.toLowerCase() === k) return true
  return e.code === keyToCode(k)
}

/**
 * Fires `handler` whenever the matching key combo is pressed.
 * Pass `enabled = false` to temporarily disable without unmounting.
 * Skips events originating from editable elements (input, textarea, contenteditable).
 */
export function useKeydown(
  combo: KeyCombo,
  handler: () => void,
  enabled = true,
) {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (!enabled) return

      // Don't steal from text inputs
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return

      if (matchesCombo(e, combo)) {
        e.preventDefault()
        handler()
      }
    }

    window.addEventListener("keydown", onKeydown)
    return () => window.removeEventListener("keydown", onKeydown)
    // `combo` is always a stable SHORTCUTS.* constant, so depending on the
    // object reference is safe and keeps the matcher's whole-combo read honest.
  }, [combo, handler, enabled])
}
