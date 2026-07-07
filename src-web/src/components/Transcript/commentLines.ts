import { RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@uiw/react-codemirror"

const commentMark = Decoration.mark({ class: "cm-line-comment" })

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      if (line.length > 0 && /^\s*\/\//.test(line.text)) {
        builder.add(line.from, line.to, commentMark)
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

class CommentPlugin {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = build(view)
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = build(u.view)
  }
}

// Force the comment color over JSON token highlighting (numbers/strings inside
// the `//` header would otherwise keep their syntax colors).
const commentTheme = EditorView.baseTheme({
  ".cm-line-comment, .cm-line-comment span": {
    color: "var(--base03) !important",
    fontStyle: "italic",
  },
})

/** Style whole `//`-prefixed lines as comments. JSON has no comment syntax, so
 *  the raw transcript's `// Message #N` headers would otherwise render plain. */
export const commentLines = [
  ViewPlugin.fromClass(CommentPlugin, {
    decorations: (v: CommentPlugin) => v.decorations,
  }),
  commentTheme,
]
