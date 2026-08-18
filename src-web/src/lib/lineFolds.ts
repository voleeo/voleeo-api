/** Line folding as runs of hidden lines: a viewer holding only a slice of its
 *  content must translate rows on screen back to real line indices before it
 *  fetches or searches anything. */

/** Inclusive `[first, last]` run of hidden line indices. */
export type HiddenRange = [number, number]

/** Union of overlapping/adjacent runs — this is what makes nesting free:
 *  collapsing an outer block swallows any fold already closed inside it. */
export function mergeRanges(ranges: HiddenRange[]): HiddenRange[] {
  const out: HiddenRange[] = []
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

export function hiddenCount(ranges: HiddenRange[]): number {
  return ranges.reduce((n, [s, e]) => n + e - s + 1, 0)
}

// ponytail: both maps walk the whole range list; fine for the handful of blocks
// a person folds by hand, swap for a binary search if "collapse all" ever ships.

/** Row on screen → line in the body. `ranges` must be merged. */
export function toRealLine(ranges: HiddenRange[], visual: number): number {
  let real = visual
  for (const [s, e] of ranges) {
    if (s > real) break
    real += e - s + 1
  }
  return real
}

/** Line in the body → row on screen. A hidden line maps to the collapsed row
 *  standing in for it. `ranges` must be merged. */
export function toVisualLine(ranges: HiddenRange[], real: number): number {
  let visual = real
  for (const [s, e] of ranges) {
    if (s > real) break
    visual -= Math.min(e, real) - s + 1
  }
  return visual
}
