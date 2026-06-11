import { RangeSetBuilder } from "@codemirror/state"
import type { DecorationSet, ViewUpdate } from "@uiw/react-codemirror"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@uiw/react-codemirror"
import type { RefObject } from "react"

/** Renders a completed `{{ … }}` token as a clickable inline chip. */
class TemplateChipWidget extends WidgetType {
  readonly isVar: boolean
  readonly name: string
  readonly displayText: string

  constructor(readonly fullMatch: string) {
    super()
    const inner = fullMatch.slice(2, -2).trim()
    const parenIdx = inner.indexOf("(")
    if (parenIdx !== -1) {
      this.isVar = false
      this.name = inner.slice(0, parenIdx).trim()
      const args = inner.slice(parenIdx).trim()
      this.displayText = args === "()" ? `${this.name}()` : `${this.name}(...)`
    } else {
      this.isVar = true
      this.name = inner
      this.displayText = inner
    }
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.textContent = this.displayText
    span.className = this.isVar ? "cm-tpl-var" : "cm-tpl-func"
    if (this.isVar) span.setAttribute("data-var", this.name)
    else span.setAttribute("data-func", this.name)
    return span
  }

  eq(other: TemplateChipWidget): boolean {
    return other.fullMatch === this.fullMatch
  }

  ignoreEvent(): boolean {
    return false // let mousedown bubble so click handler fires
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { from: selFrom, to: selTo } = view.state.selection.main
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to)
    for (const match of text.matchAll(/\{\{[^}]*\}\}/g)) {
      const start = from + match.index
      const end = start + match[0].length
      const collapsedInside =
        selFrom === selTo && selFrom > start && selFrom < end
      if (collapsedInside) continue
      builder.add(
        start,
        end,
        Decoration.replace({ widget: new TemplateChipWidget(match[0]) }),
      )
    }
  }
  return builder.finish()
}

const decorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(upd: ViewUpdate) {
      if (upd.docChanged || upd.viewportChanged || upd.selectionSet) {
        this.decorations = buildDecorations(upd.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// Makes every chip range atomic — arrow keys skip the whole token in one step.
const atomicChipRanges = EditorView.atomicRanges.of((view) => {
  const plugin = view.plugin(decorationsPlugin)
  return plugin ? plugin.decorations : Decoration.none
})

const CHIP_BASE = {
  display: "inline-block",
  borderRadius: "3px",
  padding: "0 4px",
  margin: "0 1px",
  cursor: "pointer",
  userSelect: "none",
  lineHeight: "1.4",
} as const

const templateDecorationsTheme = EditorView.baseTheme({
  ".cm-tpl-var": {
    ...CHIP_BASE,
    backgroundColor: "color-mix(in srgb, var(--base0C) 12%, transparent)",
    color: "var(--base0C)",
  },
  ".cm-tpl-func": {
    ...CHIP_BASE,
    backgroundColor: "color-mix(in srgb, var(--base0D) 12%, transparent)",
    color: "var(--base0D)",
  },
})

export function createTemplateDecorations(
  onVarClickRef: RefObject<((name: string) => void) | null>,
  onFuncClickRef?: RefObject<
    ((token: string, from: number, to: number) => void) | null
  >,
) {
  return [
    decorationsPlugin,
    atomicChipRanges,
    templateDecorationsTheme,
    EditorView.domEventHandlers({
      click(event, view) {
        const target = event.target as HTMLElement
        const varName = target.getAttribute("data-var")
        if (varName && target.classList.contains("cm-tpl-var")) {
          onVarClickRef.current?.(varName)
          return true
        }
        // A function chip opens its editor modal (provided onFuncClickRef).
        if (onFuncClickRef && target.classList.contains("cm-tpl-func")) {
          const pos = view.posAtDOM(target)
          const doc = view.state.doc.toString()
          const start = doc.lastIndexOf("{{", pos)
          const close = doc.indexOf("}}", start)
          if (start !== -1 && close !== -1) {
            const end = close + 2
            onFuncClickRef.current?.(doc.slice(start, end), start, end)
            return true
          }
        }
        return false
      },
    }),
  ]
}
