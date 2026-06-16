import { syntaxTree } from "@codemirror/language"
import type { Diagnostic } from "@codemirror/lint"
import { linter, lintGutter } from "@codemirror/lint"

export { lintGutter }

const TEMPLATE_TOKEN = /\{\{[^}]*\}\}/g

/** Mask `{{ … }}` tokens with equal-length filler so the surrounding JSON stays
 *  parseable. Length is preserved so a *real* error keeps its original offset. */
function maskTemplateTokens(text: string): string {
  return text.replace(TEMPLATE_TOKEN, (m) => "1".repeat(m.length))
}

function inTemplateToken(text: string, pos: number): boolean {
  for (const m of text.matchAll(TEMPLATE_TOKEN)) {
    const start = m.index ?? 0
    if (pos >= start && pos < start + m[0].length) return true
  }
  return false
}

export function makeJsonLinter() {
  return linter((view): Diagnostic[] => {
    const text = view.state.doc.toString()
    if (!text.trim()) return []

    const masked = maskTemplateTokens(text)
    let message = "Invalid JSON"
    try {
      JSON.parse(masked)
      return []
    } catch (e) {
      if (e instanceof SyntaxError) message = e.message
    }

    let from = -1
    let to = -1
    syntaxTree(view.state).iterate({
      enter: (n) => {
        if (from < 0 && n.type.isError && !inTemplateToken(text, n.from)) {
          from = n.from
          to = n.to
          return false
        }
      },
    })
    if (from < 0) {
      from = Math.max(0, text.length - 1)
      to = text.length
    }
    from = Math.max(0, Math.min(from, text.length - 1))
    to = to > from ? Math.min(to, text.length) : Math.min(from + 1, text.length)
    return [{ from, to, severity: "error", message }]
  })
}

/** Converts a parseerror text like "error on line 2 at column 5: …"
 *  into a character offset inside `text`. */
function xmlErrorRange(
  text: string,
  errText: string,
): { from: number; to: number } {
  const m = errText.match(/line[^\d]*(\d+)[^\d]*column[^\d]*(\d+)/i)
  if (m) {
    const targetLine = Number(m[1]) - 1 // 0-based
    const targetCol = Number(m[2]) - 1
    const lines = text.split("\n")
    let pos = 0
    for (let i = 0; i < targetLine && i < lines.length; i++) {
      pos += lines[i].length + 1
    }
    pos += Math.min(targetCol, (lines[targetLine] ?? "").length)
    return { from: pos, to: Math.min(pos + 1, text.length) }
  }
  const end = text.length
  return { from: Math.max(0, end - 1), to: end }
}

export function makeXmlLinter() {
  return linter((view): Diagnostic[] => {
    const text = view.state.doc.toString()
    if (!text.trim()) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, "application/xml")
    const errEl = doc.querySelector("parseerror")
    if (!errEl) return []
    const raw = errEl.textContent?.trim() ?? "Invalid XML"
    // Strip browser-specific preamble ("This page contains the following errors:\n")
    const message = raw.replace(/^[^\n]*\n/, "").trim() || raw
    return [{ ...xmlErrorRange(text, raw), severity: "error", message }]
  })
}
