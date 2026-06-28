import { Glyph } from "@/components/Glyph"
import { SectionLabel } from "./parts"

export function NotesSection({ notes }: { notes: string[] }) {
  return (
    <div>
      <SectionLabel>Notes</SectionLabel>
      <ul className="flex flex-col gap-2.5 rounded-xl border border-warn/30 bg-warn/10 p-4">
        {notes.map((w) => (
          <li
            key={w}
            className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted"
          >
            <span className="mt-px shrink-0 text-warn">
              <Glyph kind="info" size={15} color="currentColor" />
            </span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
