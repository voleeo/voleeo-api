import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useWebsocketStore } from "@/store/websocket"
import type { StoredWsSessionSummary } from "../../../../packages/types/bindings"

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface Props {
  workspaceId: string
  connectionId: string
  selectedId: string | null
  refreshKey: number
  live: boolean
  onSelect: (sessionId: string, isLatest: boolean) => void
  onClear: () => void
}

/** WS analog of the HTTP response `HistoryPicker`. One row per past session. */
export function WsHistoryPicker({
  workspaceId,
  connectionId,
  selectedId,
  refreshKey,
  live,
  onSelect,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<StoredWsSessionSummary[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const listSessions = useWebsocketStore((s) => s.listSessions)
  const clearTranscriptAction = useWebsocketStore((s) => s.clearTranscript)

  const load = useCallback(async () => {
    setItems(await listSessions(workspaceId, connectionId))
  }, [workspaceId, connectionId, listSessions])

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionId resets list
  useEffect(() => {
    setItems([])
    setOpen(false)
    setConfirmClear(false)
  }, [connectionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (refreshKey > 0) load()
  }, [refreshKey, load])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        buttonRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return
      setOpen(false)
      setConfirmClear(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      load()
    }
    setOpen((v) => !v)
    setConfirmClear(false)
  }, [open, load])

  const handleClear = useCallback(async () => {
    await clearTranscriptAction(workspaceId, connectionId)
    setItems([])
    setConfirmClear(false)
    setOpen(false)
    onClear()
  }, [workspaceId, connectionId, clearTranscriptAction, onClear])

  if (items.length === 0) return null

  const effectiveSelectedId = selectedId ?? items[0]?.id

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title="Session history"
        className={cn(
          "flex items-center gap-1 px-1.5 py-1 rounded-[3px] cursor-pointer border-none transition-colors",
          open
            ? "text-accent bg-accent/10"
            : "text-muted hover:text-fg bg-transparent",
        )}
      >
        <Glyph kind="history" size={13} color="currentColor" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-[9999] w-64 bg-bg border border-border rounded-[5px] shadow-lg flex flex-col max-h-[28rem]"
          >
            <ul className="flex-1 overflow-y-auto py-1 min-h-0">
              {items.map((item, idx) => {
                const isSelected = item.id === effectiveSelectedId
                const isLatest = idx === 0
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.id, isLatest)
                        setOpen(false)
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
                          "font-mono text-[0.75rem] font-bold shrink-0",
                          isSelected ? "text-accent" : "text-fg",
                        )}
                      >
                        {item.messageCount}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[0.75rem] shrink-0",
                          isSelected ? "text-accent" : "text-muted",
                        )}
                      >
                        {item.messageCount === 1 ? "msg" : "msgs"}
                      </span>
                      {isLatest && live && (
                        <span className="text-[0.643rem] font-mono uppercase tracking-wide text-success/80 shrink-0">
                          live
                        </span>
                      )}
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
                    Clear all session history?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleClear}
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
        )}
    </>
  )
}
