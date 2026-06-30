// @ts-expect-error — bun:test lacks TS types in this workspace
import { expect, test } from "bun:test"
import type { SseFrame } from "@/store/sse"
import { jsonPreview, rawSse, tryParseJson } from "./ssePreview"

function frame(p: Partial<SseFrame>): SseFrame {
  return {
    seq: 0,
    event: undefined,
    data: "",
    lastEventId: undefined,
    retry: undefined,
    atMs: 0,
    ...p,
  }
}

test("jsonPreview renders a compact object", () => {
  expect(jsonPreview({ a: 1, b: "x" })).toBe('{ "a": 1, "b": "x" }')
})

test("jsonPreview keeps nested arrays inline", () => {
  expect(jsonPreview({ a: [1, 2, 3] })).toBe('{ "a": [1, 2, 3] }')
})

test("jsonPreview truncates with an ellipsis once over budget", () => {
  const out = jsonPreview({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, 4)
  expect(out).toContain("…")
  expect(out.startsWith('{ "a": 1')).toBe(true)
})

test("tryParseJson returns the value for JSON and undefined otherwise", () => {
  expect(tryParseJson('{"x":1}')).toEqual({ x: 1 })
  expect(tryParseJson("not json")).toBeUndefined()
})

test("rawSse reconstructs wire format with event/id and multi-line data", () => {
  const out = rawSse([
    frame({ seq: 0, event: "message", data: "hello" }),
    frame({ seq: 1, event: "tick", lastEventId: "7", data: "a\nb" }),
  ])
  expect(out).toBe(
    "event: message\ndata: hello\n\nevent: tick\nid: 7\ndata: a\ndata: b\n",
  )
})

test("rawSse is empty for no frames", () => {
  expect(rawSse([])).toBe("")
})
