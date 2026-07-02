import { useRequestStore } from "@/store/requests"
import {
  type Entry,
  fmtElapsed,
  GAP_MIN_MS,
  GAP_SLOW_MS,
  PREFIX,
  TEXT_COLOR,
} from "./entries"

interface LinkedText {
  before: string
  name: string
  after: string
}

function parseLinkedText(text: string): LinkedText | null {
  const calledFrom = text.match(/^(Called from: )(.+)$/)
  if (calledFrom)
    return { before: calledFrom[1], name: calledFrom[2], after: "" }
  const preflight = text.match(/^(Pre-flight: )(.+?)( →.*)$/)
  if (preflight)
    return { before: preflight[1], name: preflight[2], after: preflight[3] }
  return null
}

export function TimelineRow({
  entry,
  prevElapsed,
}: {
  entry: Entry
  prevElapsed: number | null
}) {
  const gapMs = prevElapsed !== null ? entry.elapsedMs - prevElapsed : 0
  const showGap = prevElapsed !== null && gapMs >= GAP_MIN_MS
  const gapColor = gapMs >= GAP_SLOW_MS ? "var(--base0A)" : "var(--base04)"
  const color = TEXT_COLOR[entry.kind]

  const linked =
    entry.kind === "info" || entry.kind === "resolve"
      ? parseLinkedText(entry.text)
      : null

  function navigateTo(name: string) {
    const { requests, setActiveRequest } = useRequestStore.getState()
    const req = requests.find((r) => r.name === name)
    if (req) setActiveRequest(req.id)
  }

  return (
    <div className="flex items-baseline gap-0 hover:bg-subtle px-2">
      <span
        className="shrink-0 text-right pr-3 tabular-nums"
        style={{ color: "var(--base04)", minWidth: "92px" }}
      >
        {fmtElapsed(entry.elapsedMs)}
      </span>

      <span className="shrink-0 pr-2 font-bold select-none" style={{ color }}>
        {PREFIX[entry.kind]}
      </span>

      <span className="break-all" style={{ color }}>
        {linked ? (
          <>
            {linked.before}
            <button
              type="button"
              onClick={() => navigateTo(linked.name)}
              className="underline underline-offset-2 cursor-pointer bg-transparent border-0 outline-none p-0 font-mono text-[0.786rem] hover:opacity-70 transition-opacity"
              style={{ color: "var(--base0D)" }}
              title={`Navigate to "${linked.name}"`}
            >
              {linked.name}
            </button>
            {linked.after}
          </>
        ) : (
          entry.text
        )}
      </span>

      {showGap && (
        <span
          className="shrink-0 ml-auto pl-3 tabular-nums opacity-80"
          style={{ color: gapColor }}
          title="Time since previous visible row"
        >
          +{fmtElapsed(gapMs)}
        </span>
      )}
    </div>
  )
}
