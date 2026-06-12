import { html as htmlLang } from "@codemirror/lang-html"
import { json as jsonLang } from "@codemirror/lang-json"
import { xml as xmlLang } from "@codemirror/lang-xml"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
  tooltips,
} from "@uiw/react-codemirror"
import { html as beautifyHtmlJs } from "js-beautify"
import type { RefObject } from "react"
import { useMemo } from "react"
import { Glyph } from "@/components/Glyph"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "../cmEditorTheme"
import { foldingExtension } from "../cmFolding"
import { lintGutter, makeJsonLinter, makeXmlLinter } from "./bodyLinters"
import { createTemplateDecorations } from "./templateDecorations"
import type { BodyKind } from "./useBodyEditor"
import type { useBodyOverlay } from "./useBodyOverlay"

interface Props {
  bodyKind: BodyKind
  bodyText: string
  onVarClickRef: RefObject<((name: string) => void) | null>
  onFuncClickRef?: RefObject<
    ((token: string, from: number, to: number) => void) | null
  >
  overlay: ReturnType<typeof useBodyOverlay>
  onChange: (text: string) => void
  onBeautify: () => void
}

export function BodyEditor({
  bodyKind,
  bodyText,
  onVarClickRef,
  onFuncClickRef,
  overlay,
  onChange,
  onBeautify,
}: Props) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const isDark = activeTheme?.kind !== "light"

  const langExt = useMemo(() => {
    if (bodyKind === "json") return jsonLang()
    if (bodyKind === "xml") return xmlLang()
    if (bodyKind === "html") return htmlLang()
    return []
  }, [bodyKind])

  const linterExt = useMemo(() => {
    if (bodyKind === "json") return [lintGutter(), makeJsonLinter()]
    if (bodyKind === "xml") return [lintGutter(), makeXmlLinter()]
    return []
  }, [bodyKind])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable
  const chipDecorations = useMemo(
    () => createTemplateDecorations(onVarClickRef, onFuncClickRef),
    [],
  )

  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      ...chipDecorations,
      ...(Array.isArray(langExt) ? langExt : [langExt]),
      ...linterExt,
      // Fixed positioning so lint tooltips escape the editor's overflow-hidden
      // and render above the tab bar instead of being clipped behind it.
      tooltips({ position: "fixed" }),
      ...(bodyKind === "json" || bodyKind === "xml" || bodyKind === "html"
        ? [foldingExtension()]
        : []),
      overlay.updateListenerExt,
      overlay.keymapExt,
      EditorView.lineWrapping,
    ],
    [
      isDark,
      bodyKind,
      langExt,
      linterExt,
      chipDecorations,
      overlay.updateListenerExt,
      overlay.keymapExt,
    ],
  )

  const canBeautify =
    bodyKind === "json" || bodyKind === "xml" || bodyKind === "html"

  return (
    <>
      {canBeautify && (
        <div className="absolute top-1.5 right-2 z-10">
          <button
            type="button"
            title="Beautify"
            onClick={onBeautify}
            className="p-1 rounded-[3px] border border-border text-muted hover:text-fg hover:border-fg/30 bg-transparent cursor-pointer transition-colors"
          >
            <Glyph kind="wand" size={13} color="currentColor" />
          </button>
        </div>
      )}
      <CodeMirror
        value={bodyText}
        onChange={onChange}
        onCreateEditor={(view) => {
          overlay.editorViewRef.current = view
        }}
        theme="none"
        extensions={extensions}
        height="100%"
        // fontSize lives on the `.cm-editor` CSS rule so the Settings > Editor
        // font size dropdown can scale it.
        style={{ height: "100%" }}
        placeholder={
          bodyKind === "json"
            ? '{\n  "key": "value"\n}'
            : bodyKind === "xml"
              ? "<root>\n  <key>value</key>\n</root>"
              : bodyKind === "html"
                ? "<!doctype html>\n<html>\n  <body></body>\n</html>"
                : "Plain text body…"
        }
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: true,
          autocompletion: false,
        }}
      />
    </>
  )
}

export function beautifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function beautifyHtml(text: string): string {
  try {
    return beautifyHtmlJs(text, { indent_size: 2, wrap_line_length: 0 })
  } catch {
    return text
  }
}

export function beautifyXml(text: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, "application/xml")
    if (doc.querySelector("parsererror")) return text
    return formatXmlNode(doc.documentElement, 0)
  } catch {
    return text
  }
}

function formatXmlNode(node: Element, depth: number): string {
  const indent = "  ".repeat(depth)
  const attrs = Array.from(node.attributes)
    .map((a) => ` ${a.name}="${a.value}"`)
    .join("")
  const children = Array.from(node.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE,
  ) as Element[]
  const textContent = Array.from(node.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim() ?? "")
    .join("")
    .trim()
  if (children.length === 0) {
    if (textContent === "") return `${indent}<${node.tagName}${attrs}/>`
    return `${indent}<${node.tagName}${attrs}>${textContent}</${node.tagName}>`
  }
  const inner = children.map((c) => formatXmlNode(c, depth + 1)).join("\n")
  return `${indent}<${node.tagName}${attrs}>\n${inner}\n${indent}</${node.tagName}>`
}
