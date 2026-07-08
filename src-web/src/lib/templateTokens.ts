export type TemplateToken =
  | { kind: "plain"; text: string }
  | { kind: "var"; name: string }
  | { kind: "func"; name: string; args: Record<string, string> }

/** Finds the end index (exclusive) of the `}}` closing a token that opened at
 *  `start`, scanning quote-aware so a literal `}}` inside a `"..."` arg value
 *  doesn't terminate the token early. Returns -1 if unterminated. */
function findTokenEnd(text: string, start: number): number {
  let i = start
  let inQuotes = false
  while (i < text.length) {
    const ch = text[i]
    if (ch === "\\" && inQuotes) {
      i += 2
      continue
    }
    if (ch === '"') {
      inQuotes = !inQuotes
      i++
      continue
    }
    if (!inQuotes && ch === "}" && text[i + 1] === "}") return i
    i++
  }
  return -1
}

/** Splits a raw template string into plain-text and `{{ expr }}` tokens. */
export function tokenize(text: string): TemplateToken[] {
  const tokens: TemplateToken[] = []
  let i = 0
  let plainStart = 0

  while (i < text.length) {
    if (text[i] === "{" && text[i + 1] === "{") {
      const end = findTokenEnd(text, i + 2)
      if (end === -1) {
        i++
        continue
      }
      if (i > plainStart) {
        tokens.push({ kind: "plain", text: text.slice(plainStart, i) })
      }
      const part = text.slice(i, end + 2)
      const inner = part.slice(2, -2).trim()
      const parsed = parseExpr(inner)
      tokens.push(
        // Unrecognised expression — keep as plain text so it round-trips unchanged.
        parsed ?? { kind: "plain", text: part },
      )
      i = end + 2
      plainStart = i
    } else {
      i++
    }
  }
  if (plainStart < text.length) {
    tokens.push({ kind: "plain", text: text.slice(plainStart) })
  }

  return tokens
}

/** Escapes `\` and `"` so an arg value round-trips through the `k="v"` wire
 *  format unchanged; `unescapeArgValue` reverses this. */
function escapeArgValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function unescapeArgValue(v: string): string {
  return v.replace(/\\(.)/g, "$1")
}

export function serializeFuncToken(
  name: string,
  args: Record<string, string>,
): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}="${escapeArgValue(v)}"`)
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
      const argRe = /(\w+)="((?:\\.|[^"\\])*)"/g
      let m: RegExpExecArray | null
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
      while ((m = argRe.exec(argsRaw)) !== null) {
        args[m[1]] = unescapeArgValue(m[2])
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
