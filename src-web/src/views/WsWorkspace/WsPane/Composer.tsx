import { json as jsonLang } from "@codemirror/lang-json"
import { xml as xmlLang } from "@codemirror/lang-xml"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
  tooltips,
} from "@uiw/react-codemirror"
import { useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { Autocomplete } from "@/components/TemplateInput/Autocomplete"
import { SHORTCUTS } from "@/config/shortcuts"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useEnvironmentStore } from "@/store/environment"
import type { WsConnection } from "@/store/requests"
import { useThemeStore } from "@/store/theme"
import { useWebsocketStore } from "@/store/websocket"
import {
  beautifyJson,
  beautifyXml,
} from "@/views/ApiWorkspace/BodyTab/BodyEditor"
import {
  lintGutter,
  makeJsonLinter,
  makeXmlLinter,
} from "@/views/ApiWorkspace/BodyTab/bodyLinters"
import { createTemplateDecorations } from "@/views/ApiWorkspace/BodyTab/templateDecorations"
import { useBodyOverlay } from "@/views/ApiWorkspace/BodyTab/useBodyOverlay"
import { cmEditorTheme } from "@/views/ApiWorkspace/cmEditorTheme"
import type { WsMessageUiKind } from "./WsKindSelect"

interface Props {
  workspaceId: string
  connection: WsConnection
  canSend: boolean
  uiKind: WsMessageUiKind
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  onVarClick: (varName: string) => void
}

export function Composer({
  workspaceId,
  connection,
  canSend,
  uiKind,
  draft,
  setDraft,
  onVarClick,
}: Props) {
  const sendMessage = useWebsocketStore((s) => s.sendMessage)
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")

  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
    })),
  )
  const activeVars = useMemo(() => {
    const globalVars =
      environments
        .find((e) => e.kind === "global")
        ?.variables.filter((v) => v.enabled) ?? []
    const personalVars =
      environments
        .find((e) => e.id === activeEnvId)
        ?.variables.filter((v) => v.enabled) ?? []
    const personalKeys = new Set(personalVars.map((v) => v.key))
    return [
      ...personalVars,
      ...globalVars.filter((v) => !personalKeys.has(v.key)),
    ]
  }, [environments, activeEnvId])
  const fns = useTemplateFunctions()
  const varKeys = useMemo(() => activeVars.map((v) => v.key), [activeVars])

  const overlay = useBodyOverlay(varKeys, fns)

  // Stable ref so the chip-click decoration never captures a stale callback.
  const onVarClickRef = useRef<((name: string) => void) | null>(onVarClick)
  onVarClickRef.current = onVarClick

  const sendRef = useRef<() => void>(() => {})
  sendRef.current = () => {
    if (!draft.trim() || !canSend) return
    void sendMessage(workspaceId, connection.id, "text", draft)
  }

  const langExt = useMemo(() => {
    if (uiKind === "json") return jsonLang()
    if (uiKind === "xml") return xmlLang()
    return []
  }, [uiKind])

  const linterExt = useMemo(() => {
    if (uiKind === "json") return [lintGutter(), makeJsonLinter()]
    if (uiKind === "xml") return [lintGutter(), makeXmlLinter()]
    return []
  }, [uiKind])

  const chipDecorations = useMemo(
    () => createTemplateDecorations(onVarClickRef),
    [],
  )

  const sendKeymapExt = useMemo(
    () =>
      EditorView.domEventHandlers({
        keydown(e) {
          const mac =
            e.metaKey &&
            SHORTCUTS.SEND_REQUEST.meta &&
            e.key === SHORTCUTS.SEND_REQUEST.key
          const other =
            e.ctrlKey &&
            SHORTCUTS.SEND_REQUEST_CTRL.ctrl &&
            e.key === SHORTCUTS.SEND_REQUEST_CTRL.key
          if (mac || other) {
            e.preventDefault()
            sendRef.current()
          }
        },
      }),
    [],
  )

  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      ...chipDecorations,
      ...(Array.isArray(langExt) ? langExt : [langExt]),
      ...linterExt,
      tooltips({ position: "fixed" }),
      EditorView.lineWrapping,
      overlay.updateListenerExt,
      overlay.keymapExt,
      sendKeymapExt,
    ],
    [
      isDark,
      langExt,
      linterExt,
      chipDecorations,
      overlay.updateListenerExt,
      overlay.keymapExt,
      sendKeymapExt,
    ],
  )

  const placeholder =
    uiKind === "json"
      ? '{\n  "key": "value"\n}'
      : uiKind === "xml"
        ? "<root>\n  <key>value</key>\n</root>"
        : "Message to send"

  const canBeautify = uiKind === "json" || uiKind === "xml"
  const beautifyTitle = uiKind === "json" ? "Beautify JSON" : "Beautify XML"
  function handleBeautify() {
    const view = overlay.editorViewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    const beautified =
      uiKind === "json" ? beautifyJson(current) : beautifyXml(current)
    if (beautified === current) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: beautified },
    })
    setDraft(beautified)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {canBeautify && (
          <div className="absolute top-1.5 right-2 z-10">
            <button
              type="button"
              title={beautifyTitle}
              onClick={handleBeautify}
              className="p-1 rounded-[3px] border border-border text-muted hover:text-fg hover:border-fg/30 bg-transparent cursor-pointer transition-colors"
            >
              <Glyph kind="wand" size={13} color="currentColor" />
            </button>
          </div>
        )}
        <CodeMirror
          value={draft}
          onChange={setDraft}
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
            highlightSelectionMatches: true,
            autocompletion: false,
          }}
        />
      </div>

      {overlay.overlayState.open &&
        overlay.overlayState.anchorRect &&
        overlay.overlayState.items.length > 0 &&
        createPortal(
          <Autocomplete
            items={overlay.overlayState.items}
            selectedIndex={overlay.overlayState.selectedIndex}
            anchorRect={overlay.overlayState.anchorRect}
            query={overlay.overlayState.query}
            onSelect={overlay.selectItem}
            onClose={overlay.close}
          />,
          document.body,
        )}
    </div>
  )
}
