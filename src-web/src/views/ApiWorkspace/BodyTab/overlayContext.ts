import {
  CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete"
import type { EditorView } from "@uiw/react-codemirror"
import type { AutocompleteItem } from "@/components/TemplateInput/Autocomplete"

export interface PartialContext {
  query: string
  start: number
  ns: string | null
}

export function templateContext(before: string): PartialContext | null {
  const openIdx = before.lastIndexOf("{{")
  if (openIdx === -1 || before.slice(openIdx).includes("}}")) return null
  const query = before.slice(openIdx + 2).trimStart()
  const dot = query.indexOf(".")
  return { query, start: openIdx, ns: dot !== -1 ? query.slice(0, dot) : null }
}

export function wordContext(
  before: string,
  cursor: number,
): PartialContext | null {
  const word = before.match(/([a-zA-Z0-9_.]+)$/)?.[1]
  if (!word) return null
  const dot = word.indexOf(".")
  return {
    query: word,
    start: cursor - word.length,
    ns: dot !== -1 ? word.slice(0, dot) : null,
  }
}

export interface SchemaResult {
  from: number
  query: string
  items: AutocompleteItem[]
}

export function getSchemaCompletions(
  view: EditorView,
  pos: number,
  explicit: boolean,
): SchemaResult | null {
  const sources = view.state.languageDataAt<CompletionSource>(
    "autocomplete",
    pos,
  )
  if (sources.length === 0) return null
  const ctx = new CompletionContext(view.state, pos, explicit)
  for (const source of sources) {
    const result = source(ctx)
    if (!result || result instanceof Promise || result.options.length === 0) {
      continue
    }
    const items: AutocompleteItem[] = result.options.map((o) => ({
      kind: "schema",
      label: o.label,
      detail: typeof o.detail === "string" ? o.detail : "",
    }))
    return {
      from: result.from,
      query: view.state.sliceDoc(result.from, pos),
      items,
    }
  }
  return { from: pos, query: "", items: [] }
}
