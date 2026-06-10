import { emit, listen } from "@tauri-apps/api/event"
import type { z } from "zod"
import { create } from "zustand"
import {
  InterfaceStorageSchema,
  type WorkspaceBehaviorSchema,
} from "@/lib/schemas"

export type WorkspaceBehavior = z.infer<typeof WorkspaceBehaviorSchema>

interface InterfaceStore {
  workspaceBehavior: WorkspaceBehavior
  fontFamily: string
  fontSize: number
  editorFontFamily: string
  editorFontSize: number
  setWorkspaceBehavior: (v: WorkspaceBehavior) => void
  setFontFamily: (v: string) => void
  setFontSize: (v: number) => void
  setEditorFontFamily: (v: string) => void
  setEditorFontSize: (v: number) => void
}

const STORAGE_KEY = "voleeo:interface"

function load() {
  try {
    return InterfaceStorageSchema.parse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"),
    )
  } catch {
    return {}
  }
}

function save(patch: Partial<InterfaceStore>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...load(), ...patch }))
}

function applyFont(family: string, size: number) {
  const el = document.documentElement
  el.style.setProperty(
    "--interface-font",
    family || "-apple-system, BlinkMacSystemFont, sans-serif",
  )
  el.style.setProperty("--interface-font-size", `${size}px`)
}

// `--editor-font-family` and `--editor-font-size` are scoped to CodeMirror
// surfaces only (request body, response body, HTML response viewer, SQL
// editor) via a CSS rule in base.css that targets `.cm-editor`. The
// app-wide `font-mono` Tailwind utility stays bound to a fixed JetBrains
// Mono fallback for code-like UI badges (HTTP method, autocomplete IDs,
// etc.) so user font choices don't accidentally rebrand those.
function applyEditorFont(family: string, size: number) {
  const el = document.documentElement
  el.style.setProperty(
    "--editor-font-family",
    family || '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
  )
  el.style.setProperty("--editor-font-size", `${size}px`)
}

const saved = load()
const initFamily = saved.fontFamily ?? ""
const initSize = saved.fontSize ?? 14
const initEditorFamily = saved.editorFontFamily ?? ""
const initEditorSize = saved.editorFontSize ?? 12
applyFont(initFamily, initSize)
applyEditorFont(initEditorFamily, initEditorSize)

// Cross-window sync. Each Tauri webview has its own DOM and its own Zustand
// instance, so a change in the Settings window doesn't reach the main window
// unless we broadcast. We emit a Tauri event after every setter; every
// window (including the emitter, which is harmless — apply is idempotent)
// listens, reapplies CSS vars, persists to localStorage, and updates its
// local store state.
const INTERFACE_CHANGED = "interface:changed"

/** State shape shared by the store, localStorage, and the broadcast payload —
 *  declaring it once keeps the listener body short and the three sites in
 *  lock-step. */
type Snapshot = {
  workspaceBehavior: WorkspaceBehavior
  fontFamily: string
  fontSize: number
  editorFontFamily: string
  editorFontSize: number
}

function snapshot(): Snapshot {
  const s = useInterfaceStore.getState()
  return {
    workspaceBehavior: s.workspaceBehavior,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    editorFontFamily: s.editorFontFamily,
    editorFontSize: s.editorFontSize,
  }
}

/** Apply a snapshot end-to-end: CSS vars + localStorage + Zustand state. Used
 *  both by the cross-window listener and (indirectly) by individual setters
 *  via `broadcast` + the emitter's own listen callback. Idempotent. */
function applySnapshot(s: Snapshot): void {
  applyFont(s.fontFamily, s.fontSize)
  applyEditorFont(s.editorFontFamily, s.editorFontSize)
  save(s)
  useInterfaceStore.setState(s)
}

function broadcast() {
  void emit(INTERFACE_CHANGED, snapshot()).catch(() => {})
}

listen<Snapshot>(INTERFACE_CHANGED, (e) => applySnapshot(e.payload)).catch(
  () => {},
)

export const useInterfaceStore = create<InterfaceStore>((set, get) => ({
  workspaceBehavior: saved.workspaceBehavior ?? "ask",
  fontFamily: initFamily,
  fontSize: initSize,
  editorFontFamily: initEditorFamily,
  editorFontSize: initEditorSize,

  setWorkspaceBehavior: (workspaceBehavior) => {
    set({ workspaceBehavior })
    save({ workspaceBehavior })
    broadcast()
  },
  setFontFamily: (fontFamily) => {
    set({ fontFamily })
    applyFont(fontFamily, get().fontSize)
    save({ fontFamily })
    broadcast()
  },
  setFontSize: (fontSize) => {
    set({ fontSize })
    applyFont(get().fontFamily, fontSize)
    save({ fontSize })
    broadcast()
  },
  setEditorFontFamily: (editorFontFamily) => {
    set({ editorFontFamily })
    applyEditorFont(editorFontFamily, get().editorFontSize)
    save({ editorFontFamily })
    broadcast()
  },
  setEditorFontSize: (editorFontSize) => {
    set({ editorFontSize })
    applyEditorFont(get().editorFontFamily, editorFontSize)
    save({ editorFontSize })
    broadcast()
  },
}))
