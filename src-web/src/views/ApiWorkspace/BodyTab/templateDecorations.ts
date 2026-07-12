import { Facet, RangeSetBuilder } from "@codemirror/state"
import type { DecorationSet, ViewUpdate } from "@uiw/react-codemirror"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@uiw/react-codemirror"
import type { RefObject } from "react"
import { SYSTEM_VAR_PREFIX } from "@/lib/templateHtml"

const NO_KEYS: Set<string> = new Set()

/** Active variable keys, so var chips referencing an unknown key render red —
 *  matching the chip inputs. Editors provide it via `createTemplateDecorations`. */
export const varKeysFacet = Facet.define<Set<string>, Set<string>>({
  combine: (values) => values[0] ?? NO_KEYS,
})

export const systemKeysFacet = Facet.define<Set<string>, Set<string>>({
  combine: (values) => values[0] ?? NO_KEYS,
})

/** Renders a completed `{{ … }}` token as a clickable inline chip. */
class TemplateChipWidget extends WidgetType {
  readonly isVar: boolean
  readonly name: string
  readonly displayText: string

  constructor(
    readonly fullMatch: string,
    readonly isMissing: boolean,
    readonly isSystem: boolean,
  ) {
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
    if (this.isVar) {
      span.className = this.isMissing
        ? "cm-tpl-var cm-tpl-var-missing"
        : "cm-tpl-var"
      span.setAttribute("data-var", this.name)
      if (this.isSystem) {
        span.title = "System environment variable"
        const mark = document.createElement("span")
        mark.className = "tpl-var-sys-mark"
        mark.textContent = SYSTEM_VAR_PREFIX
        span.appendChild(mark)
        span.appendChild(document.createTextNode(this.displayText))
      } else {
        span.textContent = this.displayText
      }
    } else {
      span.className = "cm-tpl-func"
      span.setAttribute("data-func", this.name)
      span.textContent = this.displayText
    }
    return span
  }

  eq(other: TemplateChipWidget): boolean {
    return (
      other.fullMatch === this.fullMatch &&
      other.isMissing === this.isMissing &&
      other.isSystem === this.isSystem
    )
  }

  ignoreEvent(): boolean {
    return false // let mousedown bubble so click handler fires
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const varKeys = view.state.facet(varKeysFacet)
  const systemKeys = view.state.facet(systemKeysFacet)
  const { from: selFrom, to: selTo } = view.state.selection.main
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to)
    for (const match of text.matchAll(/\{\{[^}]*\}\}/g)) {
      const start = from + match.index
      const end = start + match[0].length
      const collapsedInside =
        selFrom === selTo && selFrom > start && selFrom < end
      if (collapsedInside) continue
      const inner = match[0].slice(2, -2).trim()
      const isVar = !inner.includes("(")
      const missing = isVar && !varKeys.has(inner)
      const system = isVar && systemKeys.has(inner)
      builder.add(
        start,
        end,
        Decoration.replace({
          widget: new TemplateChipWidget(match[0], missing, system),
        }),
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
      // Rebuild on edits, scroll, caret moves, and when the active var set
      // changes (reconfigured facet) so removed vars flip to the missing style.
      if (
        upd.docChanged ||
        upd.viewportChanged ||
        upd.selectionSet ||
        upd.startState.facet(varKeysFacet) !== upd.state.facet(varKeysFacet) ||
        upd.startState.facet(systemKeysFacet) !==
          upd.state.facet(systemKeysFacet)
      ) {
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
  // Two classes for higher specificity: the baseTheme is injected once per
  // editor/reconfigure, so a plain `.cm-tpl-var` can land last in source order
  // and win a same-specificity tie. `.cm-tpl-var.cm-tpl-var-missing` always wins.
  ".cm-tpl-var.cm-tpl-var-missing": {
    backgroundColor: "color-mix(in srgb, var(--base08) 14%, transparent)",
    color: "var(--base08)",
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
  varKeys: Set<string> = NO_KEYS,
  systemKeys: Set<string> = NO_KEYS,
) {
  return [
    decorationsPlugin,
    atomicChipRanges,
    templateDecorationsTheme,
    varKeysFacet.of(varKeys),
    systemKeysFacet.of(systemKeys),
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
