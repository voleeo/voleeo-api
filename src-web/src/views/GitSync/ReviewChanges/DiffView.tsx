import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { RV } from "../reviewClasses"

type Row = {
  id: number
  oldLn: number | null
  newLn: number | null
  sign: "+" | "-" | " " | "@"
  text: string
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function parsePatch(patch: string): Row[] {
  const rows: Row[] = []
  let oldLn = 0
  let newLn = 0
  const add = (r: Omit<Row, "id">) => rows.push({ ...r, id: rows.length })
  for (const line of patch.split("\n")) {
    if (line === "") continue
    if (line.startsWith("@@")) {
      const m = line.match(HUNK)
      if (m) {
        oldLn = Number(m[1])
        newLn = Number(m[2])
      }
      add({ oldLn: null, newLn: null, sign: "@", text: line })
    } else if (line.startsWith("\\")) {
      add({ oldLn: null, newLn: null, sign: "@", text: line })
    } else if (line[0] === "+") {
      add({ oldLn: null, newLn: newLn++, sign: "+", text: line.slice(1) })
    } else if (line[0] === "-") {
      add({ oldLn: oldLn++, newLn: null, sign: "-", text: line.slice(1) })
    } else {
      add({ oldLn: oldLn++, newLn: newLn++, sign: " ", text: line.slice(1) })
    }
  }
  return rows
}

export function DiffView({ patch }: { patch: string }) {
  const rows = useMemo(() => parsePatch(patch), [patch])

  if (!patch.trim()) {
    return <div className={RV.detailEmpty}>No textual changes.</div>
  }

  return (
    <div className="font-[var(--mono)] text-[length:var(--vfs)] leading-[1.5]">
      {rows.map((r) => (
        <div
          key={r.id}
          className={cn(
            "grid grid-cols-[3.5ch_3.5ch_1ch_1fr] gap-x-2 px-2",
            r.sign === "+" &&
              "bg-[color-mix(in_oklch,var(--c-add)_14%,transparent)]",
            r.sign === "-" &&
              "bg-[color-mix(in_oklch,var(--c-del)_14%,transparent)]",
            r.sign === "@" && "bg-subtle text-[var(--fg-faint)] select-none",
          )}
        >
          <span className="text-right text-muted select-none">
            {r.oldLn ?? ""}
          </span>
          <span className="text-right text-muted select-none">
            {r.newLn ?? ""}
          </span>
          <span
            className={cn(
              "select-none",
              r.sign === "+" && "text-[var(--c-add)]",
              r.sign === "-" && "text-[var(--c-del)]",
            )}
          >
            {r.sign === "+" || r.sign === "-" ? r.sign : ""}
          </span>
          <span className="selectable-text whitespace-pre-wrap break-words text-fg">
            {r.text}
          </span>
        </div>
      ))}
    </div>
  )
}
