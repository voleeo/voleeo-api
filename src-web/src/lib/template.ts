import { isAbortError } from "@/lib/abort"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { EnvironmentVariable } from "@/store/environment"

export type TemplateToken =
  | { kind: "plain"; text: string }
  | { kind: "var"; name: string }
  | { kind: "func"; name: string; args: Record<string, string> }

/** Splits a raw template string into plain-text and `{{ expr }}` tokens. */
export function tokenize(text: string): TemplateToken[] {
  // Split on {{ ... }} boundaries while keeping the delimiters.
  const parts = text.split(/({{[^}]*}})/g)
  const tokens: TemplateToken[] = []

  for (const part of parts) {
    if (!part) continue
    if (part.startsWith("{{") && part.endsWith("}}")) {
      const inner = part.slice(2, -2).trim()
      const parsed = parseExpr(inner)
      if (parsed) {
        tokens.push(parsed)
      } else {
        // Unrecognised expression — keep as plain text so it round-trips unchanged.
        tokens.push({ kind: "plain", text: part })
      }
    } else {
      tokens.push({ kind: "plain", text: part })
    }
  }

  return tokens
}

export function serializeFuncToken(
  name: string,
  args: Record<string, string>,
): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}="${v}"`)
    .join(", ")
  return argStr ? `{{ ${name}(${argStr}) }}` : `{{ ${name}() }}`
}

/** Re-serialises tokens back to the stored template string. */
export function serialize(tokens: TemplateToken[]): string {
  return tokens
    .map((tok) => {
      if (tok.kind === "plain") return tok.text
      if (tok.kind === "var") return `{{ ${tok.name} }}`
      return serializeFuncToken(tok.name, tok.args)
    })
    .join("")
}

export function parseExpr(expr: string): TemplateToken | null {
  const trimmed = expr.trim()
  if (!trimmed) return null

  // Function call: name(…) or ns.name(…)
  const funcMatch = trimmed.match(/^([\w.]+)\((.*)\)$/s)
  if (funcMatch) {
    const name = funcMatch[1]
    const argsRaw = funcMatch[2].trim()
    const args: Record<string, string> = {}
    if (argsRaw) {
      const argRe = /(\w+)="([^"]*)"/g
      let m: RegExpExecArray | null
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
      while ((m = argRe.exec(argsRaw)) !== null) {
        args[m[1]] = m[2]
      }
    }
    return { kind: "func", name, args }
  }

  // Env variable: POSIX identifier (letter/underscore first, then letters,
  // digits and `_`) — same rule as `EnvVarKeySchema`.
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return { kind: "var", name: trimmed }
  }

  return null
}

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

export interface ResolutionEvent {
  label: string
  source: string
  result: string
}

export interface ResolutionLog {
  events: ResolutionEvent[]
  label: string
}

/** Resolve `{{ … }}` tokens in `text`. The `fns` are the registry-bound
 * variants: each function already carries its owning plugin's `Context`,
 * so the resolver just passes `args`. */
export async function resolveTemplate(
  text: string,
  vars: EnvironmentVariable[],
  fns: BoundTemplateFunction[],
  log?: ResolutionLog,
): Promise<string> {
  return resolveTemplateImpl(text, vars, fns, new Set(), log)
}

async function resolveTemplateImpl(
  text: string,
  vars: EnvironmentVariable[],
  fns: BoundTemplateFunction[],
  visited: ReadonlySet<string>,
  log?: ResolutionLog,
): Promise<string> {
  const tokens = tokenize(text)
  const parts = await Promise.all(
    tokens.map(async (tok) => {
      if (tok.kind === "plain") return tok.text

      const source = serialize([tok])

      if (tok.kind === "var") {
        if (visited.has(tok.name)) return source // cycle guard
        const found = vars.find((v) => v.key === tok.name && v.enabled)
        if (!found) {
          // Surface "missing variable" as a resolution event too — that's a
          // common debugging pain point.
          if (log) {
            log.events.push({
              label: log.label,
              source,
              result: "(undefined)",
            })
          }
          return source
        }
        // Transitively resolve: ENV1={{ VAR }}, VAR=111 → ENV1=111.
        // Each recursive call gets a new Set so sibling tokens don't share state.
        const result = found.value.includes("{{")
          ? await resolveTemplateImpl(
              found.value,
              vars,
              fns,
              new Set([...visited, tok.name]),
              log,
            )
          : found.value
        if (log) log.events.push({ label: log.label, source, result })
        return result
      }

      // func
      const fn = fns.find((f) => f.name === tok.name)
      if (!fn) {
        if (log) {
          log.events.push({
            label: log.label,
            source,
            result: "(unknown function)",
          })
        }
        return source
      }
      try {
        const result = (await fn.onRender(tok.args)) ?? ""
        if (log) log.events.push({ label: log.label, source, result })
        return result
      } catch (e) {
        if (isAbortError(e)) throw e
        if (log) {
          log.events.push({
            label: log.label,
            source,
            result: `(error: ${e instanceof Error ? e.message : String(e)})`,
          })
        }
        return source
      }
    }),
  )
  return parts.join("")
}
