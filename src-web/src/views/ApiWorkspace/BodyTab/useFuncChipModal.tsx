import type { EditorView } from "@uiw/react-codemirror"
import { type RefObject, useCallback, useRef, useState } from "react"
import { EditorFunctionModal } from "@/components/EditorFunctionModal"
import { parseExpr, serializeFuncToken } from "@/lib/template"
import { commands } from "../../../../../packages/types/bindings"

interface FuncEdit {
  fnName: string
  initialArgs: Record<string, string>
  from: number
  to: number
}

export function useFuncChipModal(
  editorViewRef: RefObject<EditorView | null>,
  onChange: (text: string) => void,
  workspaceId: string | null,
) {
  const [funcEdit, setFuncEdit] = useState<FuncEdit | null>(null)

  const openFunc = useCallback(
    (
      fnName: string,
      initialArgs: Record<string, string>,
      from: number,
      to: number,
    ) => {
      setFuncEdit({ fnName, initialArgs, from, to })
    },
    [],
  )

  const onFuncClickRef = useRef<
    ((token: string, from: number, to: number) => void) | null
  >(null)
  onFuncClickRef.current = (token, from, to) => {
    const parsed = parseExpr(token.slice(2, -2).trim())
    if (parsed?.kind === "func") openFunc(parsed.name, parsed.args, from, to)
  }

  const replaceToken = useCallback(
    async (args: Record<string, string>) => {
      const edit = funcEdit
      setFuncEdit(null)
      if (!edit) return
      let finalArgs = args
      if (edit.fnName === "encrypt" && workspaceId) {
        const res = await commands.workspaceEncryptValue(
          workspaceId,
          args.value ?? "",
        )
        if (res.status !== "ok") return
        finalArgs = { ...args, value: res.data }
      }
      const token = serializeFuncToken(edit.fnName, finalArgs)
      const view = editorViewRef.current
      if (!view) return
      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: token },
      })
      onChange(view.state.doc.toString())
    },
    [funcEdit, workspaceId, editorViewRef, onChange],
  )

  const modal = funcEdit ? (
    <EditorFunctionModal
      fnName={funcEdit.fnName}
      initialArgs={funcEdit.initialArgs}
      onInsert={replaceToken}
      onClose={() => setFuncEdit(null)}
    />
  ) : null

  return { onFuncClickRef, openFunc, modal }
}
