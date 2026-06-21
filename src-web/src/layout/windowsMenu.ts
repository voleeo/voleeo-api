import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { isWindows } from "@/lib/platform"
import { useChromeStore } from "@/store/chrome"

/**
 * Windows auto-hide menu: the native menu bar is hidden by default (set in Rust)
 * and a standalone Alt tap toggles it — the OS-standard reveal gesture
 * combined with any other key (Alt+Tab, Alt+F4, mnemonics) does not toggle.
 * No-op off Windows and on secondary windows.
 */
export function initWindowsAltMenu() {
  if (!isWindows) return
  if (getCurrentWebviewWindow().label !== "main") return

  // A tap counts only if Alt was the last key pressed alone before its release.
  let altSolo = false
  window.addEventListener("keydown", (e) => {
    if (!e.repeat) altSolo = e.key === "Alt"
  })
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Alt" || !altSolo) return
    altSolo = false
    e.preventDefault()
    void useChromeStore.getState().toggleMenu()
  })
}
