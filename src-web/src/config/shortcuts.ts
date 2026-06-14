import type { KeyCombo } from "@/hooks/useKeydown"
import { isMac } from "@/lib/platform"

/**
 * Central registry of all keyboard shortcuts.
 *
 * Each entry is a KeyCombo passed directly to useKeydown().
 * Change a shortcut here and it propagates everywhere automatically.
 *
 * KeyCombo fields:
 *   key   — the key string (case-insensitive), e.g. "n", "k", "/"
 *   meta  — Cmd on macOS / Win on Windows
 *   ctrl  — Ctrl key
 *   shift — Shift key
 *   alt   — Alt / Option key
 */
export const SHORTCUTS = {
  /** Open "new item" dropdown (HTTP Request, Folder) */
  NEW_ITEM: { key: "n", meta: true } satisfies KeyCombo,

  /** Open Command Palette */
  COMMAND_PALETTE: { key: "k", meta: true } satisfies KeyCombo,

  /** Show & focus the request search field (macOS) */
  SEARCH: { key: "f", meta: true } satisfies KeyCombo,

  /** Show & focus the request search field (Windows / Linux) */
  SEARCH_CTRL: { key: "f", ctrl: true } satisfies KeyCombo,

  /** Send the selected API request (macOS) */
  SEND_REQUEST: { key: "Enter", meta: true } satisfies KeyCombo,

  /** Send the selected API request (Windows / Linux) */
  SEND_REQUEST_CTRL: { key: "Enter", ctrl: true } satisfies KeyCombo,

  /** Toggle the request/response split between columns and rows */
  TOGGLE_LAYOUT: { key: "/", meta: true } satisfies KeyCombo,

  /** Toggle the left tree panel visibility */
  TOGGLE_TREE: { key: "h", meta: true } satisfies KeyCombo,

  /** Open the Keyboard Shortcuts modal */
  SHOW_SHORTCUTS: { key: "/", meta: true, alt: true } satisfies KeyCombo,

  /** Copy the focused tree request as a cURL command (intercepts native copy
   *  only when nothing is selected — text selection still copies the text). */
  COPY_AS_CURL: { key: "c", meta: true } satisfies KeyCombo,

  /** Paste a cURL / HTTPie command from the clipboard as a new request. When
   *  a folder is focused the request is created inside it; when a request is
   *  focused it's created as a sibling. */
  PASTE_REQUEST: { key: "v", meta: true } satisfies KeyCombo,

  /** Pull the latest changes from the remote (git Update). */
  GIT_UPDATE: { key: "u", meta: true, shift: true } satisfies KeyCombo,

  /** Push local commits to the remote. */
  GIT_PUSH: { key: "p", meta: true, shift: true } satisfies KeyCombo,

  /** Open the Changes / Resolve conflicts window. */
  GIT_CHANGES: { key: "c", meta: true, shift: true } satisfies KeyCombo,

  /** Open the commit History window. */
  GIT_HISTORY: { key: "h", meta: true, shift: true } satisfies KeyCombo,

  /** Debug: show the selected request/folder's id + on-disk file info. */
  DEBUG_INFO: {
    key: "i",
    shift: true,
    ctrl: true,
    alt: true,
  } satisfies KeyCombo,
} as const

/** Which workspace a shortcut applies to. `shared` works everywhere. */

/**
 * Display metadata for the Keyboard Shortcuts modal. One entry per *logical*
 * shortcut (SEARCH_CTRL is the Windows alias of SEARCH, so it isn't listed).
 */
export const SHORTCUT_HELP: {
  combo: KeyCombo
  description: string
}[] = [
  {
    combo: SHORTCUTS.NEW_ITEM,
    description: "Create a new request or folder",
  },
  {
    combo: SHORTCUTS.COPY_AS_CURL,
    description: "Copy focused request as cURL",
  },
  {
    combo: SHORTCUTS.PASTE_REQUEST,
    description: "Paste request from clipboard (cURL / HTTPie)",
  },
  {
    combo: SHORTCUTS.COMMAND_PALETTE,
    description: "Open the command palette",
  },
  {
    // Handled by the native menu accelerator (`CmdOrCtrl+,`), not useKeydown —
    // this entry only documents it in the shortcuts modal.
    combo: { key: ",", meta: true },
    description: "Open settings",
  },
  {
    combo: SHORTCUTS.SHOW_SHORTCUTS,
    description: "Show keyboard shortcuts",
  },
  {
    combo: SHORTCUTS.TOGGLE_TREE,
    description: "Show / hide the sidebar",
  },
  {
    combo: SHORTCUTS.SEARCH,
    description: "Search requests in the current workspace",
  },
  {
    combo: SHORTCUTS.SEND_REQUEST,
    description: "Send the selected request",
  },
  {
    combo: SHORTCUTS.TOGGLE_LAYOUT,
    description: "Toggle columns / rows layout",
  },
  {
    combo: SHORTCUTS.GIT_UPDATE,
    description: "Pull the latest changes",
  },
  {
    combo: SHORTCUTS.GIT_PUSH,
    description: "Push local commits",
  },
  {
    combo: SHORTCUTS.GIT_CHANGES,
    description: "Open Changes / Resolve conflicts",
  },
  {
    combo: SHORTCUTS.GIT_HISTORY,
    description: "Open commit history",
  },
  {
    combo: SHORTCUTS.DEBUG_INFO,
    description: "Show debug info for the selected request/folder",
  },
]

/**
 * Renders a KeyCombo for the current platform. `meta` is the primary modifier:
 * ⌘ on macOS, Ctrl on Windows/Linux — matching the native `CmdOrCtrl`
 * accelerators. macOS uses tight symbols (⇧⌘N); elsewhere the Windows-style
 * `Ctrl+Shift+N`.
 */
/** Map common named keys to their symbolic form. Keeps regular character keys
 *  (a-z, digits) as-is — those are uppercased by the caller. */
const KEY_SYMBOLS: Record<string, string> = {
  enter: "↵",
  escape: "⎋",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  space: "␣",
}

function symbolize(key: string): string {
  return KEY_SYMBOLS[key.toLowerCase()] ?? key.toUpperCase()
}

export function formatKeyCombo(combo: KeyCombo): string {
  const key = symbolize(combo.key)
  if (isMac) {
    const parts: string[] = []
    if (combo.ctrl) parts.push("⌃")
    if (combo.alt) parts.push("⌥")
    if (combo.shift) parts.push("⇧")
    if (combo.meta) parts.push("⌘")
    parts.push(key)

    return parts.join("")
  }
  const parts: string[] = []
  if (combo.ctrl || combo.meta) parts.push("Ctrl")
  if (combo.alt) parts.push("Alt")
  if (combo.shift) parts.push("Shift")
  parts.push(key)
  return parts.join("+")
}
