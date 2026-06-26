import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { RV } from "../reviewClasses"

type Cell = { ln: number; text: string } | null
type Row =
  | { kind: "hunk"; id: number; text: string }
  | { kind: "pair"; id: number; left: Cell; right: Cell; change: boolean }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const HEAD =
  "px-2 py-2.5 text-[0.786rem] font-bold tracking-[0.06em] uppercase text-muted"

function parseSplit(patch: string): Row[] {
  const rows: Row[] = []
  let id = 0
  let oldLn = 0
  let newLn = 0
  let dels: { ln: number; text: string }[] = []
  let adds: { ln: number; text: string }[] = []
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      rows.push({
        kind: "pair",
        id: id++,
        left: dels[i] ?? null,
        right: adds[i] ?? null,
        change: true,
      })
    }
    dels = []
    adds = []
  }
  for (const line of patch.split("\n")) {
    if (line === "") continue
    if (line.startsWith("@@")) {
      flush()
      const m = line.match(HUNK)
      if (m) {
        oldLn = Number(m[1])
        newLn = Number(m[2])
      }
      rows.push({ kind: "hunk", id: id++, text: line })
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — orientation only, skip.
    } else if (line[0] === "+") {
      adds.push({ ln: newLn++, text: line.slice(1) })
    } else if (line[0] === "-") {
      dels.push({ ln: oldLn++, text: line.slice(1) })
    } else {
      flush()
      const text = line.slice(1)
      rows.push({
        kind: "pair",
        id: id++,
        left: { ln: oldLn++, text },
        right: { ln: newLn++, text },
        change: false,
      })
    }
  }
  flush()
  return rows
}

function SideCell({
  cell,
  sign,
  className,
}: {
  cell: Cell
  sign: "+" | "-" | " "
  className?: string
}) {
  const tint =
    cell == null
      ? "bg-subtle/40"
      : sign === "+"
        ? "bg-[color-mix(in_oklch,var(--c-add)_14%,transparent)]"
        : sign === "-"
          ? "bg-[color-mix(in_oklch,var(--c-del)_14%,transparent)]"
          : ""
  return (
    <div
      className={cn("grid grid-cols-[3.5ch_1fr] gap-x-2 px-2", tint, className)}
    >
      <span className="text-right text-muted select-none">
        {cell?.ln ?? ""}
      </span>
      <span className="whitespace-pre-wrap break-words text-fg">
        {cell?.text ?? ""}
      </span>
    </div>
  )
}

export function ConflictDiffView({ patch }: { patch: string }) {
  const rows = useMemo(() => parseSplit(patch), [patch])

  if (!patch.trim()) {
    return <div className={RV.detailEmpty}>No textual changes.</div>
  }

  return (
    <div className="font-[var(--mono)] text-[length:var(--vfs)] leading-[1.5]">
      <div className="sticky top-0 z-[1] grid grid-cols-2 bg-bg border-b border-border">
        <span className={HEAD}>Yours</span>
        <span className={cn(HEAD, "border-l border-border")}>Remote</span>
      </div>
      {rows.map((r) =>
        r.kind === "hunk" ? (
          <div
            key={r.id}
            className="px-2 bg-subtle text-[var(--fg-faint)] select-none"
          >
            {r.text}
          </div>
        ) : (
          <div key={r.id} className="grid grid-cols-2">
            <SideCell cell={r.left} sign={r.change ? "-" : " "} />
            <SideCell
              cell={r.right}
              sign={r.change ? "+" : " "}
              className="border-l border-border"
            />
          </div>
        ),
      )}
    </div>
  )
}
