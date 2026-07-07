import { json as jsonLang } from "@codemirror/lang-json"
import { yaml as yamlLang } from "@codemirror/lang-yaml"
import type { Extension } from "@codemirror/state"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
} from "@uiw/react-codemirror"
import { useMemo } from "react"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "@/views/ApiWorkspace/cmEditorTheme"

type Lang = "json" | "yaml" | "text"

const NO_EXTS: Extension[] = []

// Read-only CodeMirror renders a non-editable area, so the browser shows the
// default arrow cursor; force the text (I-beam) cursor so it reads as selectable.
const textCursor = EditorView.theme({ ".cm-content": { cursor: "text" } })

export function CodeView({
  value,
  lang = "json",
  lineNumbers = false,
  wrap = true,
  height,
  extraExtensions = NO_EXTS,
}: {
  value: string
  lang?: Lang
  lineNumbers?: boolean
  wrap?: boolean
  height?: string
  extraExtensions?: Extension[]
}) {
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")
  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      textCursor,
      ...(lang === "yaml" ? [yamlLang()] : lang === "json" ? [jsonLang()] : []),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...extraExtensions,
      EditorView.editable.of(false),
    ],
    [isDark, lang, wrap, extraExtensions],
  )
  return (
    <CodeMirror
      value={value}
      theme="none"
      editable={false}
      extensions={extensions}
      height={height}
      style={height ? { height } : undefined}
      basicSetup={{
        lineNumbers,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
      }}
    />
  )
}
