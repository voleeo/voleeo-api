// @ts-expect-error — bun:test lacks TS types in this workspace
import { expect, test } from "bun:test"
import { jsonPreview, tryParseJson } from "./ssePreview"

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
