import { json as jsonLang } from "@codemirror/lang-json"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
} from "@uiw/react-codemirror"
import { useMemo } from "react"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "@/views/ApiWorkspace/cmEditorTheme"

/** Read-only, syntax-highlighted JSON viewer. Reused across gRPC bodies and the
 *  OAuth 2.0 token inspector — CodeMirror gives native select-and-copy. */
export function JsonView({ value }: { value: string }) {
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")
  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      jsonLang(),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
    ],
    [isDark],
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
