// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import { shellTokenize } from "./shellTokenize"

describe("shellTokenize — bare words", () => {
  test("splits on whitespace", () => {
    expect(shellTokenize("curl -X GET url")).toEqual([
      "curl",
      "-X",
      "GET",
      "url",
    ])
  })
})

describe("shellTokenize — single-quoted strings", () => {
  test("literal contents, no escapes", () => {
    expect(shellTokenize("echo 'a b\\c'")).toEqual(["echo", "a b\\c"])
  })

  test("'\\'' escape sequence yields a literal quote", () => {
    expect(shellTokenize("echo 'it'\\''s'")).toEqual(["echo", "it's"])
  })

  test("unterminated single-quoted string returns null", () => {
    expect(shellTokenize("echo 'unterminated")).toBeNull()
  })
})

describe("shellTokenize — double-quoted strings", () => {
  test('interprets \\" \\\\ \\$ \\` escapes', () => {
    expect(shellTokenize('echo "a\\"b"')).toEqual(["echo", 'a"b'])
  })

  test("unterminated double-quoted string returns null", () => {
    expect(shellTokenize('echo "unterminated')).toBeNull()
  })
})

describe("shellTokenize — $'...' strings", () => {
  test("interprets C-style escapes", () => {
    expect(shellTokenize("echo $'a\\tb'")).toEqual(["echo", "a\tb"])
  })

  test("unterminated $'...' returns null", () => {
    expect(shellTokenize("echo $'unterminated")).toBeNull()
  })
})
