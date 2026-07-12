import type { Extension } from "@codemirror/state"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
  tooltips,
} from "@uiw/react-codemirror"
import { type ReactNode, useMemo, useRef } from "react"
import { Glyph } from "@/components/Glyph"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "../cmEditorTheme"
import { createTemplateDecorations } from "./templateDecorations"
import { EditorOverlayPortal, useEditorOverlay } from "./useEditorOverlay"

interface Props {
  value: string
  onChange: (v: string) => void
  langExtensions: Extension[]
  placeholder?: string
  onVarClick?: (varName: string) => void
  beautify?: (text: string) => string
  extraAction?: ReactNode
}

export function GqlBaseEditor({
  value,
  onChange,
  langExtensions,
  placeholder,
  onVarClick,
  beautify,
  extraAction,
}: Props) {
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")
  const { overlay, funcModal, varKeys } = useEditorOverlay(onChange)
  const varKeysSet = useMemo(
    () => new Set(varKeys.map((v) => v.name)),
    [varKeys],
  )
  const systemKeysSet = useMemo(
    () => new Set(varKeys.filter((v) => v.system).map((v) => v.name)),
    [varKeys],
  )

  const onVarClickRef = useRef<((name: string) => void) | null>(null)
  onVarClickRef.current = onVarClick ?? null
  const chipDecorations = useMemo(
    () =>
      createTemplateDecorations(
        onVarClickRef,
        funcModal.onFuncClickRef,
        varKeysSet,
        systemKeysSet,
      ),
    [funcModal.onFuncClickRef, varKeysSet, systemKeysSet],
  )

  const handleBeautify = () => {
    const view = overlay.editorViewRef.current
    if (!view || !beautify) return
    const current = view.state.doc.toString()
    const formatted = beautify(current)
    if (formatted === current) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    })
    onChange(formatted)
  }

  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      ...chipDecorations,
      ...langExtensions,
      tooltips({ position: "fixed" }),
      overlay.updateListenerExt,
      overlay.keymapExt,
      EditorView.lineWrapping,
    ],
    [
      isDark,
      chipDecorations,
      langExtensions,
      overlay.updateListenerExt,
      overlay.keymapExt,
    ],
  )

  return (
    <div className="h-full relative">
      {(beautify || extraAction) && (
        <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1">
          {beautify && (
            <button
              type="button"
              title="Beautify"
              onClick={handleBeautify}
              className="p-1 rounded-[3px] border border-border text-muted hover:text-fg hover:border-fg/30 bg-transparent cursor-pointer transition-colors"
            >
              <Glyph kind="wand" size={13} color="currentColor" />
            </button>
          )}
          {extraAction}
        </div>
      )}
      <CodeMirror
        value={value}
        onChange={onChange}
        onCreateEditor={(view) => {
          overlay.editorViewRef.current = view
        }}
        theme="none"
        extensions={extensions}
        height="100%"
        style={{ height: "100%" }}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          // Native popup off — schema completions render via our overlay instead.
          autocompletion: false,
        }}
      />

      <EditorOverlayPortal overlay={overlay} />
      {funcModal.modal}
    </div>
  )
}
