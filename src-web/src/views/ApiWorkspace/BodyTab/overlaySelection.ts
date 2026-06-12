import type { EditorView } from "@uiw/react-codemirror"
import type { AutocompleteItem } from "@/components/TemplateInput/Autocomplete"
import { serialize } from "@/lib/template"

interface SelectionDeps {
  partialStart: number
  close: () => void
  openAt: (
    query: string,
    partialStart: number,
    nsFilter: string | null,
    view: EditorView,
  ) => void
  onPickFunc?: (
    fnName: string,
    args: Record<string, string>,
    from: number,
    to: number,
  ) => void
}

export function applySelection(
  item: AutocompleteItem,
  view: EditorView | null,
  { partialStart: start, close, openAt, onPickFunc }: SelectionDeps,
) {
  if (!view) return
  const cursor = view.state.selection.main.head

  if (item.kind === "schema") {
    view.dispatch({
      changes: { from: start, to: cursor, insert: item.label },
      selection: { anchor: start + item.label.length },
    })
    close()
    return
  }

  if (item.kind === "namespace") {
    const insert = `{{ ${item.prefix}.`
    view.dispatch({
      changes: { from: start, to: cursor, insert },
      selection: { anchor: start + insert.length },
    })
    openAt("", start, item.prefix, view)
    return
  }

  if (item.kind === "func") {
    const fn = item.fn
    const args: Record<string, string> = {}
    for (const a of fn.args ?? []) args[a.name] = a.defaultValue ?? ""
    const argStr = (fn.args ?? [])
      .map((a) => `${a.name}="${a.defaultValue ?? ""}"`)
      .join(", ")
    const token = argStr ? `{{ ${fn.name}(${argStr}) }}` : `{{ ${fn.name}() }}`
    view.dispatch({
      changes: { from: start, to: cursor, insert: token },
      selection: { anchor: start + token.length },
    })
    close()
    onPickFunc?.(fn.name, args, start, start + token.length)
    return
  }

  if (item.kind !== "var") {
    close()
    return
  }
  const token = serialize([{ kind: "var", name: item.name }])
  view.dispatch({
    changes: { from: start, to: cursor, insert: token },
    selection: { anchor: start + token.length },
  })
  close()
}
