/** POSIX-ish shell tokenizer for command lines pasted into the URL bar.
 *
 * Handles:
 *   - Single-quoted strings: literal, no escapes (except `'\''` → `'`).
 *   - Double-quoted strings: `\"` `\\` `\$` `\`` `\\n` → escaped chars; others kept.
 *   - ANSI-C `$'…'` strings: `\n` `\t` `\r` `\\` `\'` `\"` interpreted.
 *   - Backslash-newline line continuation: removed.
 *   - Bare words: split on whitespace.
 *
 * Returns `null` if the input has unbalanced quotes — caller can fall back to
 * treating the paste as plain text rather than corrupting state. */
export function shellTokenize(input: string): string[] | null {
  // First pass: collapse backslash-newline line continuations.
  const src = input.replace(/\\\r?\n/g, "")
  const tokens: string[] = []
  let i = 0
  let current = ""
  let inToken = false

  function pushToken() {
    if (inToken) {
      tokens.push(current)
      current = ""
      inToken = false
    }
  }

  while (i < src.length) {
    const ch = src[i]

    if (!inToken && /\s/.test(ch)) {
      i++
      continue
    }

    if (ch === "'") {
      // Single-quoted: read until next single quote. Recognise `'\''` as a
      // literal single quote inside an otherwise-single-quoted span.
      inToken = true
      i++
      let closed = false
      while (i < src.length) {
        if (src[i] === "'") {
          // Lookahead for the `'\''` escape sequence
          if (src.slice(i, i + 4) === "'\\''") {
            current += "'"
            i += 4
            continue
          }
          i++
          closed = true
          break
        }
        current += src[i]
        i++
      }
      if (!closed) return null // unterminated
      continue
    }

    if (ch === '"') {
      inToken = true
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[i + 1]
          if (
            next === '"' ||
            next === "\\" ||
            next === "$" ||
            next === "`" ||
            next === "\n"
          ) {
            current += next
            i += 2
            continue
          }
        }
        current += src[i]
        i++
      }
      if (i >= src.length) return null // unterminated
      i++ // skip closing "
      continue
    }

    if (ch === "$" && src[i + 1] === "'") {
      // ANSI-C $'...' string with C-style escapes.
      inToken = true
      i += 2
      while (i < src.length && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[i + 1]
          const map: Record<string, string> = {
            n: "\n",
            t: "\t",
            r: "\r",
            "\\": "\\",
            "'": "'",
            '"': '"',
            "0": "\0",
          }
          if (next in map) {
            current += map[next]
            i += 2
            continue
          }
        }
        current += src[i]
        i++
      }
      if (i >= src.length) return null
      i++
      continue
    }

    if (ch === "\\" && i + 1 < src.length) {
      // Bare-context backslash: pass through next char literally.
      inToken = true
      current += src[i + 1]
      i += 2
      continue
    }

    if (/\s/.test(ch)) {
      pushToken()
      i++
      continue
    }

    inToken = true
    current += ch
    i++
  }

  pushToken()
  return tokens
}
