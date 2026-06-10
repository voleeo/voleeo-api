/**
 * Tests for the pure-logic parts of caret.ts.
 *
 * DOM-dependent functions (getCaretOffset, setCaretOffset, getAnchorOffset,
 * getFocusOffset, setSelectionExtended, attachAtomSnapListener,
 * ensureTrailingTextNode) require window.getSelection / document APIs that
 * bun:test does not provide without an external DOM library (happy-dom /
 * jsdom). None are installed — those functions are NOT tested here.
 *
 * Covered:
 *   extractStoredValue   — reconstructs stored template string from element DOM
 *   displayToStoredOffset — maps display char offset to stored char offset
 *   getChipRanges        — returns [start, end) of each atomic chip span
 *
 * We build minimal fake elements that satisfy the ChildNode iteration
 * interface used by these three functions (childNodes, nodeType, textContent,
 * dataset, getAttribute). No external DOM library is needed.
 */

// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import {
  displayToStoredOffset,
  extractStoredValue,
  getChipRanges,
} from "./caret"

// ---------------------------------------------------------------------------
// Minimal fake-DOM helpers
// ---------------------------------------------------------------------------

// bun:test has no DOM globals — inject Node constants used by caret.ts.
// @ts-expect-error
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 }

// node type constants (mirrors DOM Node)
const TEXT_NODE = 3
const ELEMENT_NODE = 1

function textNode(text: string) {
  return {
    nodeType: TEXT_NODE,
    textContent: text,
    length: text.length,
  }
}

function varSpan(name: string) {
  return {
    nodeType: ELEMENT_NODE,
    textContent: name,
    dataset: { tpl: "var", var: name },
    getAttribute: (attr: string) =>
      attr === "contenteditable" ? "false" : null,
  }
}

function funcSpan(fnName: string, args: Record<string, string>) {
  return {
    nodeType: ELEMENT_NODE,
    textContent:
      Object.keys(args).length > 0 ? `${fnName}(...)` : `${fnName}()`,
    dataset: { tpl: "func", func: fnName, args: JSON.stringify(args) },
    getAttribute: (attr: string) =>
      attr === "contenteditable" ? "false" : null,
  }
}

/** A span whose only purpose is to display plain text (e.g. :param segment). */
function plainSpan(text: string) {
  return {
    nodeType: ELEMENT_NODE,
    textContent: text,
    dataset: {} as Record<string, string>,
    getAttribute: (_attr: string) => null,
  }
}

type FakeNode = ReturnType<
  typeof textNode | typeof varSpan | typeof funcSpan | typeof plainSpan
>

function fakeEl(children: FakeNode[]) {
  return { childNodes: children } as unknown as HTMLElement
}

// ---------------------------------------------------------------------------
// extractStoredValue
// ---------------------------------------------------------------------------

describe("extractStoredValue — plain text only", () => {
  test("single text node", () => {
    expect(extractStoredValue(fakeEl([textNode("hello")]))).toBe("hello")
  })

  test("empty element → ''", () => {
    expect(extractStoredValue(fakeEl([]))).toBe("")
  })

  test("multiple text nodes concatenated", () => {
    expect(extractStoredValue(fakeEl([textNode("foo"), textNode("bar")]))).toBe(
      "foobar",
    )
  })

  test("newlines stripped (single-line mode default)", () => {
    expect(extractStoredValue(fakeEl([textNode("a\nb")]))).toBe("ab")
  })

  test("newlines preserved in multiline mode", () => {
    expect(
      extractStoredValue(fakeEl([textNode("a\nb")]), { multiline: true }),
    ).toBe("a\nb")
  })
})

describe("extractStoredValue — var chip", () => {
  test("var chip → {{ NAME }}", () => {
    expect(extractStoredValue(fakeEl([varSpan("AUTH_HOST")]))).toBe(
      "{{ AUTH_HOST }}",
    )
  })

  test("text + var chip + text", () => {
    expect(
      extractStoredValue(
        fakeEl([textNode("https://"), varSpan("HOST"), textNode("/api")]),
      ),
    ).toBe("https://{{ HOST }}/api")
  })

  test("two var chips adjacent", () => {
    expect(extractStoredValue(fakeEl([varSpan("A"), varSpan("B")]))).toBe(
      "{{ A }}{{ B }}",
    )
  })
})

describe("extractStoredValue — func chip", () => {
  test("no-arg func → {{ fn() }}", () => {
    expect(extractStoredValue(fakeEl([funcSpan("uuid.v4", {})]))).toBe(
      "{{ uuid.v4() }}",
    )
  })

  test('func with args → {{ fn(k="v") }}', () => {
    expect(
      extractStoredValue(
        fakeEl([funcSpan("uuid.v3", { name: "foo", namespace: "ns" })]),
      ),
    ).toBe('{{ uuid.v3(name="foo", namespace="ns") }}')
  })
})

describe("extractStoredValue — unknown/param chip", () => {
  test("plain span (no tpl) → textContent as-is", () => {
    expect(extractStoredValue(fakeEl([plainSpan(":id")]))).toBe(":id")
  })
})

// ---------------------------------------------------------------------------
// displayToStoredOffset
// ---------------------------------------------------------------------------

describe("displayToStoredOffset — plain text only", () => {
  test("offset 0 → 0", () => {
    expect(displayToStoredOffset(fakeEl([textNode("hello")]), 0)).toBe(0)
  })

  test("offset 3 in plain text → 3", () => {
    expect(displayToStoredOffset(fakeEl([textNode("hello")]), 3)).toBe(3)
  })

  test("offset at end → full text length", () => {
    expect(displayToStoredOffset(fakeEl([textNode("hello")]), 5)).toBe(5)
  })

  test("offset past end → text length", () => {
    expect(displayToStoredOffset(fakeEl([textNode("hi")]), 99)).toBe(2)
  })
})

describe("displayToStoredOffset — with var chip", () => {
  // Layout: "https://"(8) + varSpan("HOST")(4 display, 13 stored = "{{ HOST }}")
  // stored: "https://{{ HOST }}"
  const el = fakeEl([textNode("https://"), varSpan("HOST")])

  test("offset before chip stays in plain text zone", () => {
    expect(displayToStoredOffset(el, 3)).toBe(3)
  })

  test("offset 8 = just before chip → 8 stored", () => {
    expect(displayToStoredOffset(el, 8)).toBe(8)
  })

  test("offset inside chip snaps to after chip in stored space", () => {
    // chip display len = 4 ("HOST"), stored len = "{{ HOST }}".length = 10
    const storedAfterChip = "https://".length + "{{ HOST }}".length // 8 + 10 = 18
    expect(displayToStoredOffset(el, 9)).toBe(storedAfterChip)
    expect(displayToStoredOffset(el, 12)).toBe(storedAfterChip)
  })

  test("offset exactly at chip end snaps to after chip", () => {
    const storedAfterChip = 8 + "{{ HOST }}".length
    expect(displayToStoredOffset(el, 12)).toBe(storedAfterChip)
  })
})

describe("displayToStoredOffset — with func chip", () => {
  // Layout: funcSpan("uuid.v4", {}) → display "uuid.v4()" (9 chars)
  //         stored: "{{ uuid.v4() }}" (15 chars)
  const el = fakeEl([funcSpan("uuid.v4", {})])

  test("offset 0 before chip → 0", () => {
    // At displayOffset 0, the element loop never enters the 'displayOffset <=
    // displayPos' early-return since displayPos starts at 0, so the chip is
    // consumed and storedPos advances. The function returns storedPos=0 at the
    // very start (before the chip node is processed).
    // Actual behaviour: offset 0 is ≤ displayPos(0), so returns storedPos(0).
    expect(displayToStoredOffset(el, 0)).toBe(0)
  })

  test("offset inside chip → after chip stored position", () => {
    const storedLen = "{{ uuid.v4() }}".length // 15
    expect(displayToStoredOffset(el, 5)).toBe(storedLen)
  })
})

// ---------------------------------------------------------------------------
// getChipRanges
// ---------------------------------------------------------------------------

describe("getChipRanges — no chips", () => {
  test("plain text only → []", () => {
    expect(getChipRanges(fakeEl([textNode("hello")]))).toEqual([])
  })

  test("empty element → []", () => {
    expect(getChipRanges(fakeEl([]))).toEqual([])
  })
})

describe("getChipRanges — single chip", () => {
  test("lone var chip → [{start:0, end:displayLen}]", () => {
    // "AUTH_HOST" → 9 display chars
    expect(getChipRanges(fakeEl([varSpan("AUTH_HOST")]))).toEqual([
      { start: 0, end: 9 },
    ])
  })

  test("plain text then chip → chip offset is after text", () => {
    // "hi" (2) then varSpan("X") (1)
    expect(getChipRanges(fakeEl([textNode("hi"), varSpan("X")]))).toEqual([
      { start: 2, end: 3 },
    ])
  })

  test("chip then plain text → chip range is at start", () => {
    expect(getChipRanges(fakeEl([varSpan("K"), textNode(" rest")]))).toEqual([
      { start: 0, end: 1 },
    ])
  })
})

describe("getChipRanges — multiple chips", () => {
  test("two adjacent chips", () => {
    // varSpan("A")(1) + varSpan("BC")(2)
    expect(getChipRanges(fakeEl([varSpan("A"), varSpan("BC")]))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ])
  })

  test("text + chip + text + chip", () => {
    // "ab"(2) + varSpan("X")(1) + "c"(1) + varSpan("YY")(2)
    expect(
      getChipRanges(
        fakeEl([textNode("ab"), varSpan("X"), textNode("c"), varSpan("YY")]),
      ),
    ).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 6 },
    ])
  })
})

describe("getChipRanges — plain span (no contenteditable=false)", () => {
  test("plain span without contenteditable=false is NOT included", () => {
    // plainSpan returns null for getAttribute("contenteditable")
    expect(getChipRanges(fakeEl([plainSpan("text")]))).toEqual([])
  })
})
