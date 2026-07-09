import { emit, listen } from "@tauri-apps/api/event"
import type { z } from "zod"
import { create } from "zustand"
import { EVENTS } from "@/config/events"
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
  wrapResponse: boolean
  setWorkspaceBehavior: (v: WorkspaceBehavior) => void
  setFontFamily: (v: string) => void
  setFontSize: (v: number) => void
  setEditorFontFamily: (v: string) => void
  setEditorFontSize: (v: number) => void
  setWrapResponse: (v: boolean) => void
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
const initWrapResponse = saved.wrapResponse ?? false
applyFont(initFamily, initSize)
applyEditorFont(initEditorFamily, initEditorSize)

type Snapshot = {
  workspaceBehavior: WorkspaceBehavior
  fontFamily: string
  fontSize: number
  editorFontFamily: string
  editorFontSize: number
  wrapResponse: boolean
}

function snapshot(): Snapshot {
  const s = useInterfaceStore.getState()
  return {
    workspaceBehavior: s.workspaceBehavior,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    editorFontFamily: s.editorFontFamily,
    editorFontSize: s.editorFontSize,
    wrapResponse: s.wrapResponse,
  }
}

function applySnapshot(s: Snapshot): void {
  applyFont(s.fontFamily, s.fontSize)
  applyEditorFont(s.editorFontFamily, s.editorFontSize)
  save(s)
  useInterfaceStore.setState(s)
}

function broadcast() {
  void emit(EVENTS.interfaceChanged, snapshot()).catch(() => {})
}

listen<Snapshot>(EVENTS.interfaceChanged, (e) =>
  applySnapshot(e.payload),
).catch(() => {})

export const useInterfaceStore = create<InterfaceStore>((set, get) => ({
  workspaceBehavior: saved.workspaceBehavior ?? "ask",
  fontFamily: initFamily,
  fontSize: initSize,
  editorFontFamily: initEditorFamily,
  editorFontSize: initEditorSize,
  wrapResponse: initWrapResponse,

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
  setWrapResponse: (wrapResponse) => {
    set({ wrapResponse })
    save({ wrapResponse })
    broadcast()
  },
}))
