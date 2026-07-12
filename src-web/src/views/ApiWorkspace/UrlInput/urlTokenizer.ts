import { parseExpr } from "@/lib/template"
import { SYSTEM_VAR_MARK } from "@/lib/templateHtml"

type Segment =
  | { kind: "plain"; text: string }
  | { kind: "param"; text: string }
  | { kind: "tpl"; text: string; tplKind: "var" | "func" }

/** Splits a stored URL string into plain text, :param, and {{ expr }} segments. */
export function tokenize(url: string): Segment[] {
  const segments: Segment[] = []
  const tplParts = url.split(/({{[^}]*}})/g)

  for (const part of tplParts) {
    if (!part) continue

    if (part.startsWith("{{") && part.endsWith("}}")) {
      const inner = part.slice(2, -2).trim()
      const isFuncCall = /^[\w.]+\(.*\)$/s.test(inner)
      segments.push({
        kind: "tpl",
        text: part,
        tplKind: isFuncCall ? "func" : "var",
      })
      continue
    }

    // Split on :param patterns within plain text.
    const re = /:([a-zA-Z_][a-zA-Z0-9_]*)/g
    let last = 0
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
    while ((m = re.exec(part)) !== null) {
      if (m.index > last)
        segments.push({ kind: "plain", text: part.slice(last, m.index) })
      segments.push({ kind: "param", text: m[0] })
      last = m.index + m[0].length
    }
    if (last < part.length)
      segments.push({ kind: "plain", text: part.slice(last) })
  }

  return segments
}

function escHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function chipStyle(color: string): string {
  return (
    `display:inline-block;background-color:color-mix(in srgb,${color} 12%,transparent);` +
    `color:${color};border-radius:3px;padding:0 4px;margin:0 1px;cursor:pointer;`
  )
}

const PRIMARY_CHIP = chipStyle("var(--base0D)")
const INFO_CHIP = chipStyle("var(--base0C)")
const ERROR_CHIP = chipStyle("var(--base08)")

/** Renders a stored URL to innerHTML for the contenteditable div.
 *  Query params are stripped — they live in the Params tab, not the URL bar. */
export function toHtml(
  url: string,
  varStatus: (name: string) => "found" | "missing" | "system",
  funcStatus: (name: string) => "ok" | "error",
): string {
  const displayUrl = url.split("?")[0]
  return tokenize(displayUrl)
    .map((seg) => {
      if (seg.kind === "plain") return escHtml(seg.text)

      if (seg.kind === "param") {
        return `<span contenteditable="false" data-param="true" style="${PRIMARY_CHIP}">${escHtml(seg.text)}</span>`
      }

      if (seg.tplKind === "var") {
        const name = seg.text.slice(2, -2).trim()
        const status = varStatus(name)
        const missing = status === "missing"
        const system = status === "system"
        const style = missing ? ERROR_CHIP : INFO_CHIP
        const title = missing
          ? ` title="Variable &quot;${escHtml(name)}&quot; not found in active environment"`
          : system
            ? ' title="System environment variable"'
            : ""
        return (
          `<span contenteditable="false" data-tpl="var" data-var="${escHtml(name)}"` +
          `${missing ? ' data-missing="true"' : ""}${title} style="${style}">` +
          `${system ? SYSTEM_VAR_MARK : ""}${escHtml(name)}</span>`
        )
      }

      // func
      const inner = seg.text.slice(2, -2).trim()
      const tok = parseExpr(inner)
      if (tok?.kind === "func") {
        const hasArgs = Object.keys(tok.args).length > 0
        const display = hasArgs ? `${tok.name}(...)` : `${tok.name}()`
        const argsJson = escHtml(JSON.stringify(tok.args))
        const isError = funcStatus(tok.name) === "error"
        const style = isError ? ERROR_CHIP : PRIMARY_CHIP
        const errorAttr = isError ? ' data-func-error="true"' : ""
        const title = isError
          ? ` title="Workspace encryption is not enabled — click to enable in Storage settings"`
          : ""
        return (
          `<span contenteditable="false" data-tpl="func" data-func="${escHtml(tok.name)}" data-args="${argsJson}"` +
          `${errorAttr}${title} style="${style}">${escHtml(display)}</span>`
        )
      }
      return `<span contenteditable="false" data-tpl="func" style="${PRIMARY_CHIP}">${escHtml(inner)}</span>`
    })
    .join("")
}
