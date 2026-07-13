import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { useInterfaceStore } from "@/store/interface"

type Row = {
  oldLn: number | null
  newLn: number | null
  sign: " " | "+" | "-"
  text: string
}

function prettyIfJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

// LCS line diff → git-style unified rows (context + added/removed). O(m·n) memory;
// snapshot bodies are small, so bail to a plain positional diff if either side is
// huge rather than allocate a giant table.
// ponytail: LCS DP, capped at 1500 lines/side — upgrade to Myers if it ever bites.
function lcsRows(a: string[], b: string[]): Row[] {
  const m = a.length
  const n = b.length
  if (m > 1500 || n > 1500) {
    const rows: Row[] = []
    const len = Math.max(m, n)
    for (let i = 0; i < len; i++) {
      if (i >= m)
        rows.push({ oldLn: null, newLn: i + 1, sign: "+", text: b[i] })
      else if (i >= n)
        rows.push({ oldLn: i + 1, newLn: null, sign: "-", text: a[i] })
      else if (a[i] === b[i])
        rows.push({ oldLn: i + 1, newLn: i + 1, sign: " ", text: a[i] })
      else {
        rows.push({ oldLn: i + 1, newLn: null, sign: "-", text: a[i] })
        rows.push({ oldLn: null, newLn: i + 1, sign: "+", text: b[i] })
      }
    }
    return rows
  }
  const dp: Int32Array[] = Array.from(
    { length: m + 1 },
    () => new Int32Array(n + 1),
  )
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: Row[] = []
  let i = 0
  let j = 0
  let ol = 1
  let nl = 1
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ oldLn: ol++, newLn: nl++, sign: " ", text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ oldLn: ol++, newLn: null, sign: "-", text: a[i] })
      i++
    } else {
      rows.push({ oldLn: null, newLn: nl++, sign: "+", text: b[j] })
      j++
    }
  }
  while (i < m) rows.push({ oldLn: ol++, newLn: null, sign: "-", text: a[i++] })
  while (j < n) rows.push({ oldLn: null, newLn: nl++, sign: "+", text: b[j++] })
  return interleaveChanges(rows)
}

// LCS emits each change block as all "-" lines then all "+" lines. Interleave
// them (−old, +new, −old, +new, …) so a changed line reads as its removal with
// the replacement directly beneath it; trailing extras keep their order.
function interleaveChanges(rows: Row[]): Row[] {
  const out: Row[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].sign === " ") {
      out.push(rows[i++])
      continue
    }
    const removed: Row[] = []
    const added: Row[] = []
    while (i < rows.length && rows[i].sign !== " ") {
      ;(rows[i].sign === "-" ? removed : added).push(rows[i])
      i++
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      if (k < removed.length) out.push(removed[k])
      if (k < added.length) out.push(added[k])
    }
  }
  return out
}

/** Git-style unified diff of the saved response body vs the latest replay's. */
export function DiffPanel({
  savedBody,
  freshBody,
  isText,
}: {
  savedBody: string
  freshBody: string
  isText: boolean
}) {
  const wrap = useInterfaceStore((s) => s.wrapResponse)
  const rows = useMemo(() => {
    if (!isText) return null
    const a = prettyIfJson(savedBody).split("\n")
    const b = prettyIfJson(freshBody).split("\n")
    return lcsRows(a, b)
  }, [savedBody, freshBody, isText])

  if (!isText) {
    const identical = savedBody === freshBody
    return (
      <div className="selectable-text px-3.5 py-2 font-mono text-[0.786rem]">
        {identical ? (
          <span className="text-success">Binary body identical</span>
        ) : (
          <span className="text-warn">
            Binary body differs ({savedBody.length} → {freshBody.length} bytes)
          </span>
        )}
      </div>
    )
  }

  if (rows?.every((r) => r.sign === " ")) {
    return (
      <div className="selectable-text px-3.5 py-2 font-mono text-[0.786rem] text-success">
        Body identical
      </div>
    )
  }

  return (
    <div
      className={cn(
        "selectable-text editor-text leading-[1.5] py-1",
        !wrap && "w-max min-w-full",
      )}
    >
      {rows?.map((r, idx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id
          key={idx}
          className={cn(
            "grid grid-cols-[3.5ch_3.5ch_1ch_1fr] gap-x-2 px-3",
            r.sign === "+" && "bg-success/10",
            r.sign === "-" && "bg-error/10",
          )}
        >
          <span className="text-right text-muted/60 select-none">
            {r.oldLn ?? ""}
          </span>
          <span className="text-right text-muted/60 select-none">
            {r.newLn ?? ""}
          </span>
          <span
            className={cn(
              "select-none text-center",
              r.sign === "+" && "text-success",
              r.sign === "-" && "text-error",
            )}
          >
            {r.sign === " " ? "" : r.sign}
          </span>
          <span
            className={cn(
              "text-fg",
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            )}
          >
            {r.text}
          </span>
        </div>
      ))}
    </div>
  )
}
