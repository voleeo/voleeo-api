import { json as jsonLang } from "@codemirror/lang-json"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  oneDark,
} from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useShallow } from "zustand/react/shallow"
import { EditorFunctionModal } from "@/components/EditorFunctionModal"
import {
  Autocomplete,
  type VarSuggestion,
} from "@/components/TemplateInput/Autocomplete"
import { parseExpr, serializeFuncToken } from "@/lib/template"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useEnvironmentStore } from "@/store/environment"
import { useThemeStore } from "@/store/theme"
import {
  lintGutter,
  makeJsonLinter,
} from "@/views/ApiWorkspace/BodyTab/bodyLinters"
import { createTemplateDecorations } from "@/views/ApiWorkspace/BodyTab/templateDecorations"
import { useBodyOverlay } from "@/views/ApiWorkspace/BodyTab/useBodyOverlay"
import { cmEditorTheme } from "@/views/ApiWorkspace/cmEditorTheme"
import { commands } from "../../../../../packages/types/bindings"
import type { FormValue } from "../ProtoMessageForm"

interface FuncEdit {
  fnName: string
  initialArgs: Record<string, string>
  from: number
  to: number
}

export function MessageEditor({
  value,
  onChange,
  onVarClick,
  workspaceId,
}: {
  value: FormValue
  onChange: (v: FormValue) => void
  onVarClick?: (varName: string) => void
  workspaceId: string
}) {
  const isDark = useThemeStore((s) => s.activeTheme?.kind !== "light")
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))

  const valueJson = JSON.stringify(value, null, 2)
  useEffect(() => {
    setText((prev) => {
      try {
        if (JSON.stringify(JSON.parse(prev)) === JSON.stringify(value)) {
          return prev
        }
      } catch {
        // prev is mid-edit invalid - fall through and adopt the external value.
      }
      return valueJson
    })
  }, [valueJson, value])

  const { environments, activeEnvId, systemEnvVars } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
      systemEnvVars: s.systemEnvVars,
    })),
  )
  const varKeys = useMemo(() => {
    const globals =
      environments.find((e) => e.kind === "global")?.variables ?? []
    const personal =
      environments.find((e) => e.id === activeEnvId)?.variables ?? []
    const keys = new Set<string>()
    for (const v of [...personal, ...globals]) if (v.enabled) keys.add(v.key)
    const out: VarSuggestion[] = [...keys].map((name) => ({ name }))
    for (const v of systemEnvVars)
      if (!keys.has(v.key)) out.push({ name: v.key, system: true })
    return out
  }, [environments, activeEnvId, systemEnvVars])
  const fns = useTemplateFunctions()
  const overlay = useBodyOverlay(varKeys, fns)
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

  // Clicking a `{{ fn(...) }}` chip opens the same modal the form uses.
  const [funcEdit, setFuncEdit] = useState<FuncEdit | null>(null)
  const onFuncClickRef = useRef<
    ((token: string, from: number, to: number) => void) | null
  >(null)
  onFuncClickRef.current = (token, from, to) => {
    const parsed = parseExpr(token.slice(2, -2).trim())
    if (parsed?.kind === "func")
      setFuncEdit({ fnName: parsed.name, initialArgs: parsed.args, from, to })
  }

  const chipDecorations = useMemo(
    () =>
      createTemplateDecorations(
        onVarClickRef,
        onFuncClickRef,
        varKeysSet,
        systemKeysSet,
      ),
    [varKeysSet, systemKeysSet],
  )

  async function replaceFuncToken(args: Record<string, string>) {
    const edit = funcEdit
    setFuncEdit(null)
    if (!edit) return
    let finalArgs = args
    // `encrypt` stores ciphertext, never the plaintext, in the token.
    if (edit.fnName === "encrypt" && workspaceId) {
      const res = await commands.workspaceEncryptValue(
        workspaceId,
        args.value ?? "",
      )
      if (res.status !== "ok") return
      finalArgs = { ...args, value: res.data }
    }
    const token = serializeFuncToken(edit.fnName, finalArgs)
    const view = overlay.editorViewRef.current
    if (!view) return
    view.dispatch({ changes: { from: edit.from, to: edit.to, insert: token } })
    const next = view.state.doc.toString()
    setText(next)
    try {
      const parsed = JSON.parse(next)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        onChange(parsed as FormValue)
    } catch {
      // invalid mid-edit — leave the value as-is
    }
  }

  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      jsonLang(),
      lintGutter(),
      makeJsonLinter(),
      ...chipDecorations,
      overlay.updateListenerExt,
      overlay.keymapExt,
      EditorView.lineWrapping,
    ],
    [isDark, chipDecorations, overlay.updateListenerExt, overlay.keymapExt],
  )

  return (
    <div className="h-full relative">
      <CodeMirror
        value={text}
        onChange={(t) => {
          setText(t)
          try {
            const parsed = JSON.parse(t)
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              onChange(parsed as FormValue)
            }
          } catch {
            // Mid-edit invalid JSON — keep the text, don't propagate.
          }
        }}
        onCreateEditor={(view) => {
          overlay.editorViewRef.current = view
        }}
        theme="none"
        extensions={extensions}
        height="100%"
        style={{ height: "100%" }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
        }}
      />

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

      {funcEdit && (
        <EditorFunctionModal
          fnName={funcEdit.fnName}
          initialArgs={funcEdit.initialArgs}
          onInsert={replaceFuncToken}
          onClose={() => setFuncEdit(null)}
        />
      )}
    </div>
  )
}
