import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react"
import { IconToggle } from "@/components/IconToggle"
import type { TranscriptViewState } from "./useTranscriptView"

export function TranscriptToolbar<T>({
  view,
  count,
}: {
  view: TranscriptViewState<T>
  count: number
}) {
  if (count === 0) return null
  return (
    <div className="ml-auto flex items-center gap-0.5 pr-0.5">
      {!view.raw && (
        <IconToggle
          icon={
            view.allExpanded ? (
              <ChevronsDownUpIcon size={14} />
            ) : (
              <ChevronsUpDownIcon size={14} />
            )
          }
          title={view.allExpanded ? "Collapse all" : "Expand all"}
          onClick={view.toggleExpandAll}
        />
      )}
      <IconToggle
        glyph="search"
        title="Search messages"
        active={view.searchOpen}
        onClick={() => view.setSearchOpen(!view.searchOpen)}
      />
      <IconToggle
        glyph="code"
        title={view.raw ? "Show messages" : "Show raw"}
        active={view.raw}
        onClick={() => view.setRaw(!view.raw)}
      />
    </div>
  )
}
