#!/usr/bin/env bun
// Enforce the AGENTS.md file-size limits so oversized files fail CI instead of
// creeping back. Web .ts/.tsx in src-web/src cap at 250 lines; Rust .rs cap at
// 500 lines excluding #[cfg(test)] blocks. Vendored shadcn/ui and generated
// bindings are exempt (not our hand-written code).
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"

const WEB_LIMIT = 250
const RUST_LIMIT = 500

const listFiles = (glob) =>
  execSync(`git ls-files ${glob}`, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter(existsSync) // skip files deleted/moved in the working tree

const isExempt = (f) =>
  f.includes("src-web/src/components/ui/") ||
  f.endsWith(".test.ts") ||
  f.endsWith(".test.tsx") ||
  f.endsWith(".d.ts")

// Split into physical lines matching `wc -l` — a trailing newline (which biome
// and rustfmt both enforce) is a terminator, not an extra empty line.
function toLines(text) {
  const lines = text.split("\n")
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines
}

// Non-test line count: drop every `#[cfg(test)]`-attributed block by
// brace-matching the item that follows the attribute.
function rustNonTestLines(text) {
  const lines = toLines(text)
  let excluded = 0
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("#[cfg(test)]")) continue
    // Find the first `{` at or after this attribute, then match to its `}`.
    let depth = 0
    let started = false
    let j = i
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++
          started = true
        } else if (ch === "}") depth--
      }
      if (started && depth <= 0) break
    }
    excluded += j - i + 1
    i = j
  }
  return lines.length - excluded
}

const violations = []

for (const f of listFiles("'src-web/src/**/*.ts' 'src-web/src/**/*.tsx'")) {
  if (isExempt(f)) continue
  const n = toLines(readFileSync(f, "utf8")).length
  if (n > WEB_LIMIT) violations.push({ f, n, limit: WEB_LIMIT })
}

for (const f of listFiles("'crates/**/*.rs' 'crates-tauri/**/*.rs' 'src-tauri/**/*.rs'")) {
  const n = rustNonTestLines(readFileSync(f, "utf8"))
  if (n > RUST_LIMIT) violations.push({ f, n, limit: RUST_LIMIT })
}

if (violations.length === 0) {
  console.log("file sizes OK")
  process.exit(0)
}

violations.sort((a, b) => b.n - a.n)
for (const { f, n, limit } of violations) {
  console.error(`::error file=${f}::${f} is ${n} lines (limit ${limit}) — split it (AGENTS.md)`)
}
console.error(`\n${violations.length} file(s) over the size limit.`)
process.exit(1)
