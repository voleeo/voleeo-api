// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import {
  type HiddenRange,
  hiddenCount,
  mergeRanges,
  toRealLine,
  toVisualLine,
} from "./lineFolds"

describe("mergeRanges", () => {
  test("sorts and leaves separated runs alone", () => {
    expect(
      mergeRanges([
        [8, 9],
        [3, 5],
      ]),
    ).toEqual([
      [3, 5],
      [8, 9],
    ])
  })

  test("nested folds collapse into the outer one", () => {
    expect(
      mergeRanges([
        [1, 100],
        [10, 20],
      ]),
    ).toEqual([[1, 100]])
  })

  test("touching runs merge", () => {
    expect(
      mergeRanges([
        [3, 5],
        [6, 8],
      ]),
    ).toEqual([[3, 8]])
  })
})

describe("toRealLine / toVisualLine", () => {
  // One block open on line 2 hides lines 3-5; another on line 7 hides 8-9.
  const ranges: HiddenRange[] = [
    [3, 5],
    [8, 9],
  ]

  test("rows before the first fold are unshifted", () => {
    expect(toRealLine(ranges, 2)).toBe(2)
    expect(toVisualLine(ranges, 2)).toBe(2)
  })

  test("rows after a fold skip its hidden lines", () => {
    expect(toRealLine(ranges, 3)).toBe(6)
    expect(toRealLine(ranges, 4)).toBe(7)
    expect(toRealLine(ranges, 5)).toBe(10)
    expect(toVisualLine(ranges, 6)).toBe(3)
    expect(toVisualLine(ranges, 10)).toBe(5)
  })

  test("round-trips for every visible row", () => {
    for (let v = 0; v < 8; v++) {
      expect(toVisualLine(ranges, toRealLine(ranges, v))).toBe(v)
    }
  })

  test("a hidden line maps to the collapsed row standing in for it", () => {
    expect(toVisualLine(ranges, 4)).toBe(2)
    expect(toVisualLine(ranges, 9)).toBe(4)
  })

  test("no folds is the identity", () => {
    expect(toRealLine([], 42)).toBe(42)
    expect(toVisualLine([], 42)).toBe(42)
    expect(hiddenCount([])).toBe(0)
  })

  test("hiddenCount sums the runs", () => {
    expect(hiddenCount(ranges)).toBe(5)
  })
})
