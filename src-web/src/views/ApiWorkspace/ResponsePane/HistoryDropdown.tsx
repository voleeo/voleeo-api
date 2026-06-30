import type { RefObject } from "react"
import { createPortal } from "react-dom"
import { ActiveIndicator } from "@/components/ActiveIndicator"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import type { StoredHttpResponseSummary } from "../../../../../packages/types/bindings"
import { formatDuration } from "./format"

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface Props {
  pos: { top: number; right: number }
  dropdownRef: RefObject<HTMLDivElement | null>
  items: StoredHttpResponseSummary[]
  loading: boolean
  selectedId: string | null
  confirmClear: boolean
  setConfirmClear: (v: boolean) => void
  onSelect: (responseId: string, isLatest: boolean) => void
  onShowLive: () => void
  onClear: () => void
  close: () => void
}

/** The portal panel of the response history picker: an optional live entry,
 *  the stored-response list, and the clear-history footer. */
export function HistoryDropdown({
  pos,
  dropdownRef,
  items,
  loading,
  selectedId,
  confirmClear,
  setConfirmClear,
  onSelect,
  onShowLive,
  onClear,
  close,
}: Props) {
  // While streaming, the synthetic "live" entry is the default selection; only
  // an explicit historical pick selects a stored item. Otherwise fall back to
  // the latest item so the just-finished response appears pre-selected.
  const liveSelected = loading && selectedId === null
  const effectiveSelectedId = selectedId ?? (loading ? null : items[0]?.id)

  return createPortal(
    <div
      ref={dropdownRef}
      style={{ position: "fixed", top: pos.top, right: pos.right }}
      className="z-[9999] w-64 bg-bg border border-border rounded-[5px] shadow-lg flex flex-col max-h-[28rem]"
    >
      <ul className="flex-1 overflow-y-auto py-1 min-h-0">
        {loading && (
          <li>
            <button
              type="button"
              onClick={() => {
                onShowLive()
                close()
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none transition-colors",
                liveSelected
                  ? "bg-success/10 text-success"
                  : "bg-transparent hover:bg-surface",
              )}
            >
              <ActiveIndicator />
              <span
                className={cn(
                  "font-mono text-[0.75rem]",
                  liveSelected ? "text-success" : "text-muted",
                )}
              >
                Streaming
              </span>
              <span
                className={cn(
                  "text-[0.75rem] shrink-0 ml-auto",
                  liveSelected ? "text-success/70" : "text-muted/60",
                )}
              >
                live
              </span>
              {liveSelected && (
                <Glyph kind="check" size={10} color="currentColor" />
              )}
            </button>
          </li>
        )}
        {items.map((item, idx) => {
          const isSelected = item.id === effectiveSelectedId
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(item.id, idx === 0)
                  close()
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none transition-colors",
                  isSelected
                    ? "bg-accent/10 text-accent"
                    : "bg-transparent hover:bg-surface",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[0.714rem] font-bold shrink-0",
                    isSelected
                      ? "text-accent"
                      : item.status < 300
                        ? "text-success"
                        : item.status < 500
                          ? "text-amber-500"
                          : "text-destructive",
                  )}
                >
                  {item.status}
                </span>
                <Glyph
                  kind="arrow"
                  size={9}
                  color={isSelected ? "var(--base0D)" : "var(--base04)"}
                />
                <span
                  className={cn(
                    "font-mono text-[0.75rem] shrink-0",
                    isSelected ? "text-accent" : "text-muted",
                  )}
                >
                  {formatDuration(item.totalMs ?? 0)}
                </span>
                <span
                  className={cn(
                    "text-[0.75rem] shrink-0 ml-auto",
                    isSelected ? "text-accent/70" : "text-muted/60",
                  )}
                >
                  {formatRelative(item.recordedAt)}
                </span>
                {isSelected && (
                  <Glyph kind="check" size={10} color="currentColor" />
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-border py-1 shrink-0">
        {confirmClear ? (
          <div className="px-3 py-2">
            <p className="text-[0.75rem] text-fg mb-2 leading-snug">
              Clear all response history?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClear}
                className="flex-1 px-2 py-1 rounded-[3px] bg-destructive/15 text-destructive text-[0.75rem] font-medium cursor-pointer border-none hover:bg-destructive/25 transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 px-2 py-1 rounded-[3px] bg-surface text-muted text-[0.75rem] cursor-pointer border-none hover:text-fg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none bg-transparent text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors"
          >
            <Glyph kind="trash" size={11} color="currentColor" />
            <span className="text-[0.75rem]">Clear History</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
