import { json as jsonLang } from "@codemirror/lang-json"
import { yaml as yamlLang } from "@codemirror/lang-yaml"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
} from "@uiw/react-codemirror"
import { useMemo } from "react"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "@/views/ApiWorkspace/cmEditorTheme"

type Lang = "json" | "yaml"

/** Read-only, syntax-highlighted code viewer. Used for gRPC/JSON bodies, the
 *  OAuth 2.0 token inspector, and the debug modal's raw YAML — CodeMirror gives
 *  native select-and-copy. */
export function CodeView({
  value,
  lang = "json",
}: {
  value: string
  lang?: Lang
}) {
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")
  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      lang === "yaml" ? yamlLang() : jsonLang(),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
    ],
    [isDark, lang],
  )
  return (
    <CodeMirror
      value={value}
      theme="none"
      editable={false}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
      }}
    />
  )
}
