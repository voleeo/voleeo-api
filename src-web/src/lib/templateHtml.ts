import { tokenize } from "./templateTokens"

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const BASE_SPAN =
  "display:inline-block;border-radius:3px;padding:0 4px;margin:0 1px;cursor:pointer;"

const VAR_STYLE = `${BASE_SPAN}background-color:color-mix(in srgb,var(--base0C) 12%,transparent);color:var(--base0C);`

const VAR_MISSING_STYLE = `${BASE_SPAN}background-color:color-mix(in srgb,var(--base08) 12%,transparent);color:var(--base08);`

const FUNC_STYLE = `${BASE_SPAN}background-color:color-mix(in srgb,var(--base0D) 12%,transparent);color:var(--base0D);`

const FUNC_ERROR_STYLE = `${BASE_SPAN}background-color:color-mix(in srgb,var(--base08) 12%,transparent);color:var(--base08);`

export function toHtml(
  text: string,
  varStatus: (name: string) => "found" | "missing",
  funcStatus?: (name: string, args: Record<string, string>) => "ok" | "error",
): string {
  return tokenize(text)
    .map((tok) => {
      if (tok.kind === "plain") return escHtml(tok.text)

      if (tok.kind === "var") {
        const missing = varStatus(tok.name) === "missing"
        const style = missing ? VAR_MISSING_STYLE : VAR_STYLE
        const title = missing
          ? ` title="Variable &quot;${escHtml(tok.name)}&quot; not found in active environment"`
          : ""
        return (
          `<span contenteditable="false" data-tpl="var" data-var="${escHtml(tok.name)}"` +
          `${missing ? ' data-missing="true"' : ""}${title} style="${style}">` +
          `${escHtml(tok.name)}</span>`
        )
      }

      // func — show name(...) when args are present, name() when none.
      // Full args are preserved in data-args so they round-trip unchanged.
      const hasArgs = Object.keys(tok.args).length > 0
      const display = hasArgs ? `${tok.name}(...)` : `${tok.name}()`
      const argsJson = escHtml(JSON.stringify(tok.args))
      const isError = funcStatus?.(tok.name, tok.args) === "error"
      const style = isError ? FUNC_ERROR_STYLE : FUNC_STYLE
      const errorAttr = isError ? ' data-func-error="true"' : ""
      const title = isError
        ? ` title="Workspace encryption is not enabled — click to enable in Storage settings"`
        : ""
      return (
        `<span contenteditable="false" data-tpl="func" data-func="${escHtml(tok.name)}" data-args="${argsJson}"` +
        `${errorAttr}${title} style="${style}">` +
        `${escHtml(display)}</span>`
      )
    })
    .join("")
}
