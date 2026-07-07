// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { EnvironmentVariable } from "@/store/environment"
import {
  parseExpr,
  resolveTemplate,
  serialize,
  serializeFuncToken,
  toHtml,
  tokenize,
} from "./template"

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize — plain text", () => {
  test("empty string → []", () => {
    expect(tokenize("")).toEqual([])
  })

  test("no tokens → single plain token", () => {
    expect(tokenize("hello world")).toEqual([
      { kind: "plain", text: "hello world" },
    ])
  })

  test("plain text preserves whitespace", () => {
    expect(tokenize("  a  b  ")).toEqual([{ kind: "plain", text: "  a  b  " }])
  })
})

describe("tokenize — env-var token", () => {
  test("{{ AUTH_HOST }}", () => {
    expect(tokenize("{{ AUTH_HOST }}")).toEqual([
      { kind: "var", name: "AUTH_HOST" },
    ])
  })

  test("{{ MY_VAR_123 }}", () => {
    expect(tokenize("{{ MY_VAR_123 }}")).toEqual([
      { kind: "var", name: "MY_VAR_123" },
    ])
  })

  test("leading-underscore identifier", () => {
    expect(tokenize("{{ _PRIV }}")).toEqual([{ kind: "var", name: "_PRIV" }])
  })
})

describe("tokenize — func token", () => {
  test("no-arg {{ uuid.v4() }}", () => {
    expect(tokenize("{{ uuid.v4() }}")).toEqual([
      { kind: "func", name: "uuid.v4", args: {} },
    ])
  })

  test('single arg {{ uuid.v3(name="foo", namespace="ns") }}', () => {
    expect(tokenize('{{ uuid.v3(name="foo", namespace="ns") }}')).toEqual([
      { kind: "func", name: "uuid.v3", args: { name: "foo", namespace: "ns" } },
    ])
  })

  test('simple named arg {{ fn(key="val") }}', () => {
    expect(tokenize('{{ fn(key="val") }}')).toEqual([
      { kind: "func", name: "fn", args: { key: "val" } },
    ])
  })
})

describe("tokenize — mixed text + tokens", () => {
  test("prefix text + token", () => {
    expect(tokenize("https://{{ HOST }}/api")).toEqual([
      { kind: "plain", text: "https://" },
      { kind: "var", name: "HOST" },
      { kind: "plain", text: "/api" },
    ])
  })

  test("two tokens adjacent with no separator", () => {
    const result = tokenize("{{ A }}{{ B }}")
    expect(result).toEqual([
      { kind: "var", name: "A" },
      { kind: "var", name: "B" },
    ])
  })

  test("text + func token + text", () => {
    const result = tokenize("id={{ uuid.v4() }}&t=1")
    expect(result).toEqual([
      { kind: "plain", text: "id=" },
      { kind: "func", name: "uuid.v4", args: {} },
      { kind: "plain", text: "&t=1" },
    ])
  })
})

describe("tokenize — malformed / unclosed {{", () => {
  test("unclosed {{ kept as plain text", () => {
    // No closing }} found, so the scan falls through and it stays plain.
    expect(tokenize("{{ unclosed")).toEqual([
      { kind: "plain", text: "{{ unclosed" },
    ])
  })

  test("unrecognised expression (e.g. numeric literal) kept as plain text", () => {
    // parseExpr returns null → kept verbatim
    expect(tokenize("{{ 42 }}")).toEqual([{ kind: "plain", text: "{{ 42 }}" }])
  })

  test("empty braces {{ }} → kept as plain (empty trimmed expr → null)", () => {
    expect(tokenize("{{ }}")).toEqual([{ kind: "plain", text: "{{ }}" }])
  })

  test("expression with dot but no parens is plain text (not a valid var)", () => {
    expect(tokenize("{{ a.b }}")).toEqual([
      { kind: "plain", text: "{{ a.b }}" },
    ])
  })
})

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

describe("serialize", () => {
  test("empty tokens → ''", () => {
    expect(serialize([])).toBe("")
  })

  test("plain text round-trips", () => {
    expect(serialize([{ kind: "plain", text: "hello" }])).toBe("hello")
  })

  test("var token → {{ NAME }}", () => {
    expect(serialize([{ kind: "var", name: "AUTH_HOST" }])).toBe(
      "{{ AUTH_HOST }}",
    )
  })

  test("func token with no args → {{ fn() }}", () => {
    expect(serialize([{ kind: "func", name: "uuid.v4", args: {} }])).toBe(
      "{{ uuid.v4() }}",
    )
  })

  test('func token with args → {{ fn(k="v") }}', () => {
    expect(
      serialize([
        {
          kind: "func",
          name: "uuid.v3",
          args: { name: "foo", namespace: "ns" },
        },
      ]),
    ).toBe('{{ uuid.v3(name="foo", namespace="ns") }}')
  })

  test("mixed tokens round-trip", () => {
    const input = "https://{{ HOST }}/id={{ uuid.v4() }}"
    expect(serialize(tokenize(input))).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// serialize(tokenize(x)) === x round-trips
// ---------------------------------------------------------------------------

describe("serialize(tokenize(x)) === x round-trips", () => {
  const cases = [
    "plain string",
    "{{ AUTH_HOST }}",
    "{{ uuid.v4() }}",
    '{{ uuid.v3(name="foo", namespace="urn:uuid:ns") }}',
    "https://{{ HOST }}/api?id={{ uuid.v4() }}&key={{ API_KEY }}",
    "{{ unclosed",
    "{{ 42 }}",
    "{{ }}",
  ]
  for (const s of cases) {
    test(JSON.stringify(s), () => {
      expect(serialize(tokenize(s))).toBe(s)
    })
  }
})

describe("tokenize/serialize round-trip — arg values with special chars", () => {
  test('arg value containing a literal `"` round-trips', () => {
    const tokens = tokenize('{{ fn(k="say \\"hi\\"") }}')
    expect(tokens).toEqual([
      { kind: "func", name: "fn", args: { k: 'say "hi"' } },
    ])
    expect(serialize(tokens)).toBe('{{ fn(k="say \\"hi\\"") }}')
    expect(tokenize(serialize(tokens))).toEqual(tokens)
  })

  test("arg value containing a literal `}}` round-trips", () => {
    const tokens = tokenize('{{ fn(k="a }} b") }}')
    expect(tokens).toEqual([
      { kind: "func", name: "fn", args: { k: "a }} b" } },
    ])
    expect(serialize(tokens)).toBe('{{ fn(k="a }} b") }}')
    expect(tokenize(serialize(tokens))).toEqual(tokens)
  })

  test("arg value containing a backslash round-trips", () => {
    const tokens = tokenize('{{ fn(k="a\\\\b") }}')
    expect(tokens).toEqual([{ kind: "func", name: "fn", args: { k: "a\\b" } }])
    expect(serialize(tokens)).toBe('{{ fn(k="a\\\\b") }}')
    expect(tokenize(serialize(tokens))).toEqual(tokens)
  })

  test("plain text following a `}}`-containing arg is preserved", () => {
    const input = '{{ fn(k="a }} b") }} rest'
    const tokens = tokenize(input)
    expect(tokens).toEqual([
      { kind: "func", name: "fn", args: { k: "a }} b" } },
      { kind: "plain", text: " rest" },
    ])
    expect(serialize(tokens)).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// parseExpr
// ---------------------------------------------------------------------------

describe("parseExpr", () => {
  test("identifier → var", () => {
    expect(parseExpr("AUTH_HOST")).toEqual({ kind: "var", name: "AUTH_HOST" })
  })

  test("identifier with spaces trimmed", () => {
    expect(parseExpr("  MY_VAR  ")).toEqual({ kind: "var", name: "MY_VAR" })
  })

  test("fn() → func with empty args", () => {
    expect(parseExpr("uuid.v4()")).toEqual({
      kind: "func",
      name: "uuid.v4",
      args: {},
    })
  })

  test('fn(k="v") → func with args', () => {
    expect(parseExpr('fn(k="v")')).toEqual({
      kind: "func",
      name: "fn",
      args: { k: "v" },
    })
  })

  test("empty string → null", () => {
    expect(parseExpr("")).toBeNull()
  })

  test("only whitespace → null", () => {
    expect(parseExpr("   ")).toBeNull()
  })

  test("dotted identifier without parens → null (not a valid var or func)", () => {
    expect(parseExpr("a.b")).toBeNull()
  })

  test("numeric → null", () => {
    expect(parseExpr("42")).toBeNull()
  })

  test('fn(k="say \\"hi\\"") → unescapes the quote in the value', () => {
    expect(parseExpr('fn(k="say \\"hi\\"")')).toEqual({
      kind: "func",
      name: "fn",
      args: { k: 'say "hi"' },
    })
  })

  test('fn(k="a\\\\b") → unescapes the backslash in the value', () => {
    expect(parseExpr('fn(k="a\\\\b")')).toEqual({
      kind: "func",
      name: "fn",
      args: { k: "a\\b" },
    })
  })
})

// ---------------------------------------------------------------------------
// serializeFuncToken
// ---------------------------------------------------------------------------

describe("serializeFuncToken", () => {
  test("no args → {{ fn() }}", () => {
    expect(serializeFuncToken("uuid.v4", {})).toBe("{{ uuid.v4() }}")
  })

  test('one arg → {{ fn(k="v") }}', () => {
    expect(serializeFuncToken("fn", { k: "v" })).toBe('{{ fn(k="v") }}')
  })

  test("two args joined with ', '", () => {
    expect(serializeFuncToken("f", { a: "1", b: "2" })).toBe(
      '{{ f(a="1", b="2") }}',
    )
  })

  test('escapes `"` in an arg value', () => {
    expect(serializeFuncToken("fn", { k: 'say "hi"' })).toBe(
      '{{ fn(k="say \\"hi\\"") }}',
    )
  })

  test("escapes `\\` in an arg value", () => {
    expect(serializeFuncToken("fn", { k: "a\\b" })).toBe('{{ fn(k="a\\\\b") }}')
  })
})

// ---------------------------------------------------------------------------
// toHtml
// ---------------------------------------------------------------------------

function alwaysFound(_name: string): "found" | "missing" {
  return "found"
}

function alwaysMissing(_name: string): "found" | "missing" {
  return "missing"
}

describe("toHtml — plain text HTML escaping", () => {
  test("ampersand escaped", () => {
    expect(toHtml("a&b", alwaysFound)).toContain("a&amp;b")
  })

  test("< and > escaped", () => {
    const h = toHtml("<script>", alwaysFound)
    expect(h).toContain("&lt;script&gt;")
  })

  test("double-quote escaped", () => {
    expect(toHtml('"hi"', alwaysFound)).toContain("&quot;hi&quot;")
  })

  test("plain text with no special chars round-trips", () => {
    expect(toHtml("hello world", alwaysFound)).toBe("hello world")
  })
})

describe("toHtml — var token HTML", () => {
  test("found var has data-tpl=var and data-var attributes", () => {
    const h = toHtml("{{ AUTH_HOST }}", alwaysFound)
    expect(h).toContain('data-tpl="var"')
    expect(h).toContain('data-var="AUTH_HOST"')
  })

  test("found var does NOT have data-missing attribute", () => {
    expect(toHtml("{{ HOST }}", alwaysFound)).not.toContain("data-missing")
  })

  test("missing var has data-missing=true", () => {
    const h = toHtml("{{ GONE }}", alwaysMissing)
    expect(h).toContain('data-missing="true"')
  })

  test("var name in display text is HTML-escaped", () => {
    // Unlikely in practice but must be safe: a name cannot contain < but
    // the escHtml path is shared, so verify the display value goes through it.
    const h = toHtml("{{ AUTH_HOST }}", alwaysFound)
    expect(h).toContain(">AUTH_HOST<")
  })
})

describe("toHtml — func token HTML", () => {
  test("no-arg func has data-tpl=func and data-func attributes", () => {
    const h = toHtml("{{ uuid.v4() }}", alwaysFound)
    expect(h).toContain('data-tpl="func"')
    expect(h).toContain('data-func="uuid.v4"')
  })

  test("no-arg func displays as 'uuid.v4()'", () => {
    expect(toHtml("{{ uuid.v4() }}", alwaysFound)).toContain(">uuid.v4()<")
  })

  test("func with args displays as 'uuid.v3(...)'", () => {
    const h = toHtml('{{ uuid.v3(name="foo") }}', alwaysFound)
    expect(h).toContain(">uuid.v3(...)<")
  })

  test("func token data-args attribute contains HTML-escaped JSON", () => {
    // toHtml escapes quotes in the data-args attribute: " → &quot;
    const h = toHtml('{{ uuid.v3(name="foo") }}', alwaysFound)
    expect(h).toContain("&quot;foo&quot;")
  })

  test("funcStatus error adds data-func-error attr", () => {
    const h = toHtml("{{ uuid.v4() }}", alwaysFound, () => "error")
    expect(h).toContain("data-func-error")
  })

  test("funcStatus ok does NOT add data-func-error attr", () => {
    const h = toHtml("{{ uuid.v4() }}", alwaysFound, () => "ok")
    expect(h).not.toContain("data-func-error")
  })
})

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------

function makeVar(
  key: string,
  value: string,
  enabled = true,
): EnvironmentVariable {
  return { key, value, encrypted: false, enabled }
}

function makeFn(name: string, result: string): BoundTemplateFunction {
  return { name, onRender: async () => result }
}

describe("resolveTemplate — plain text", () => {
  test("plain string passes through unchanged", async () => {
    expect(await resolveTemplate("hello world", [], [])).toBe("hello world")
  })
})

describe("resolveTemplate — var resolution", () => {
  test("resolves known variable", async () => {
    const vars = [makeVar("HOST", "api.example.com")]
    expect(await resolveTemplate("https://{{ HOST }}/api", vars, [])).toBe(
      "https://api.example.com/api",
    )
  })

  test("missing var → token kept as-is", async () => {
    expect(await resolveTemplate("{{ GONE }}", [], [])).toBe("{{ GONE }}")
  })

  test("disabled var → treated as missing (token kept)", async () => {
    const vars = [makeVar("KEY", "secret", false)]
    expect(await resolveTemplate("{{ KEY }}", vars, [])).toBe("{{ KEY }}")
  })

  test("transitive resolution: ENV1={{ VAR }}, VAR=111 → ENV1=111", async () => {
    const vars = [makeVar("ENV1", "{{ VAR }}"), makeVar("VAR", "111")]
    expect(await resolveTemplate("{{ ENV1 }}", vars, [])).toBe("111")
  })

  test("cycle guard: self-referencing var returns token, no infinite loop", async () => {
    const vars = [makeVar("SELF", "{{ SELF }}")]
    expect(await resolveTemplate("{{ SELF }}", vars, [])).toBe("{{ SELF }}")
  })
})

describe("resolveTemplate — function resolution", () => {
  test("known no-arg function is called", async () => {
    const fns = [makeFn("uuid.v4", "aaaaaaaa-0000")]
    expect(await resolveTemplate("{{ uuid.v4() }}", [], fns)).toBe(
      "aaaaaaaa-0000",
    )
  })

  test("unknown function → token kept as-is", async () => {
    expect(await resolveTemplate("{{ unknown.fn() }}", [], [])).toBe(
      "{{ unknown.fn() }}",
    )
  })

  test("function returning null → empty string", async () => {
    const fns: BoundTemplateFunction[] = [
      { name: "noop", onRender: async () => null },
    ]
    expect(await resolveTemplate("{{ noop() }}", [], fns)).toBe("")
  })

  test("function that throws → token kept as-is", async () => {
    const fns: BoundTemplateFunction[] = [
      {
        name: "boom",
        onRender: async () => {
          throw new Error("oops")
        },
      },
    ]
    expect(await resolveTemplate("{{ boom() }}", [], fns)).toBe("{{ boom() }}")
  })
})

describe("resolveTemplate — mixed text + tokens", () => {
  test("multiple vars in one string", async () => {
    const vars = [makeVar("HOST", "host.io"), makeVar("PATH", "/v1")]
    expect(
      await resolveTemplate("https://{{ HOST }}{{ PATH }}", vars, []),
    ).toBe("https://host.io/v1")
  })

  test("var and func in same string", async () => {
    const vars = [makeVar("PREFIX", "id")]
    const fns = [makeFn("uuid.v4", "abc-123")]
    expect(
      await resolveTemplate("{{ PREFIX }}-{{ uuid.v4() }}", vars, fns),
    ).toBe("id-abc-123")
  })
})
