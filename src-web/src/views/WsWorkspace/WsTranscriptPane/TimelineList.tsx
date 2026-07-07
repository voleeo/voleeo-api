import type { TimelineEvent } from "../../../../../packages/types/bindings"

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="px-3 py-6 text-center font-mono text-[0.714rem] text-muted">
        No events yet
      </div>
    )
  }
  return (
    <>
      {events.map((e, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, never reordered
          key={`${e.atMs}-${e.kind}-${i}`}
          className="flex gap-2 px-3 py-1 border-b border-border/50 font-mono text-[0.714rem]"
        >
          <span className="text-muted w-14 shrink-0">
            {(e.atMs ?? 0).toFixed(0)}ms
          </span>
          <span className="uppercase text-accent w-16 shrink-0">{e.kind}</span>
          <span className="text-fg break-all">{e.text}</span>
        </div>
      ))}
    </>
  )
}
