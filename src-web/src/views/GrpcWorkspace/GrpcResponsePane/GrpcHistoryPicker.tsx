import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/views/ApiWorkspace/ResponsePane/format"
import { commands } from "../../../../../packages/types/bindings"

interface Row {
  id: string
  recordedAt: string
  statusCode?: number
  totalMs?: number | null
  messageCount?: number
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface Props {
  workspaceId: string
  requestId: string
  mode: "unary" | "session"
  selectedId: string | null
  refreshKey: number
  onSelect: (id: string, isLatest: boolean) => void
  onClear: () => void
}

/** Past unary responses or streaming sessions for a gRPC request, in a portal
 *  dropdown anchored under the clock button — the gRPC analog of the HTTP
 *  response `HistoryPicker`. */
export function GrpcHistoryPicker({
  workspaceId,
  requestId,
  mode,
  selectedId,
  refreshKey,
  onSelect,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Row[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (mode === "unary") {
      const res = await commands.grpcListUnaryResponses(workspaceId, requestId)
      if (res.status === "ok") setItems(res.data)
    } else {
      const res = await commands.grpcListSessions(workspaceId, requestId)
      if (res.status === "ok") setItems(res.data)
    }
  }, [workspaceId, requestId, mode])

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestId/mode reset the list
  useEffect(() => {
    setItems([])
    setOpen(false)
  }, [requestId, mode])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (refreshKey > 0) load()
  }, [refreshKey, load])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || dropdownRef.current?.contains(t))
        return
      setOpen(false)
      setConfirmClear(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const toggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
    setConfirmClear(false)
  }, [open])

  const handleClear = useCallback(async () => {
    if (mode === "unary")
      await commands.grpcClearUnaryResponses(workspaceId, requestId)
    else await commands.grpcClearTranscript(workspaceId, requestId)
    setItems([])
    setConfirmClear(false)
    setOpen(false)
    onClear()
  }, [workspaceId, requestId, mode, onClear])

  if (items.length === 0) return null
  const effectiveSelectedId = selectedId ?? items[0]?.id

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Response history"
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
                const ok = (item.statusCode ?? 0) === 0
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.id, idx === 0)
                        setOpen(false)
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none transition-colors",
                        isSelected
                          ? "bg-accent/10 text-accent"
                          : "bg-transparent hover:bg-surface",
                      )}
                    >
                      {mode === "unary" ? (
                        <>
                          <span
                            className={cn(
                              "font-mono text-[0.714rem] font-bold shrink-0",
                              isSelected
                                ? "text-accent"
                                : ok
                                  ? "text-success"
                                  : "text-destructive",
                            )}
                          >
                            {item.statusCode}
                          </span>
                          <span
                            className={cn(
                              "font-mono text-[0.75rem] shrink-0",
                              isSelected ? "text-accent" : "text-muted",
                            )}
                          >
                            {formatDuration(item.totalMs ?? 0)}
                          </span>
                        </>
                      ) : (
                        <span
                          className={cn(
                            "font-mono text-[0.75rem] shrink-0",
                            isSelected ? "text-accent" : "text-muted",
                          )}
                        >
                          {item.messageCount} msg
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
                    Clear all {mode === "unary" ? "response" : "session"}{" "}
                    history?
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
