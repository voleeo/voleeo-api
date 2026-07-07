import { useCallback, useEffect, useRef, useState } from "react"
import { IconToggle } from "@/components/IconToggle"
import type { StoredHttpResponseSummary } from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import { HistoryDropdown } from "./HistoryDropdown"

interface Props {
  workspaceId: string
  requestId: string
  selectedId: string | null
  refreshKey: number
  loading: boolean
  onSelect: (responseId: string, isLatest: boolean) => void
  onShowLive: () => void
  onClear: () => void
}

export function HistoryPicker({
  workspaceId,
  requestId,
  selectedId,
  refreshKey,
  loading,
  onSelect,
  onShowLive,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<StoredHttpResponseSummary[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{
    top: number
    right: number
  } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await commands.responseList(workspaceId, requestId)
    if (res.status === "ok") setItems(res.data)
  }, [workspaceId, requestId])

  // Reset immediately on request change to prevent showing stale list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: requestId is the reset trigger
  useEffect(() => {
    setItems([])
    setOpen(false)
    setConfirmClear(false)
  }, [requestId])

  // Fetch whenever the request changes — drives button visibility count.
  useEffect(() => {
    load()
  }, [load])

  // Re-fetch when a new response is stored for this request.
  useEffect(() => {
    if (refreshKey > 0) load()
  }, [refreshKey, load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        buttonRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
      setConfirmClear(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      // Capture position before opening so the portal can place itself.
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
    setConfirmClear(false)
  }, [open])

  const handleClear = useCallback(async () => {
    await commands.responseClear(workspaceId, requestId)
    setItems([])
    setConfirmClear(false)
    setOpen(false)
    onClear()
  }, [workspaceId, requestId, onClear])

  // Hide entirely when there's nothing to show (no history and not streaming).
  if (items.length === 0 && !loading) return null

  return (
    <>
      <IconToggle
        buttonRef={buttonRef}
        glyph="history"
        title="Response history"
        active={open}
        onClick={handleToggle}
      />
      {open && dropdownPos && (
        <HistoryDropdown
          pos={dropdownPos}
          dropdownRef={dropdownRef}
          items={items}
          loading={loading}
          selectedId={selectedId}
          confirmClear={confirmClear}
          setConfirmClear={setConfirmClear}
          onSelect={onSelect}
          onShowLive={onShowLive}
          onClear={handleClear}
          close={() => setOpen(false)}
        />
      )}
    </>
  )
}
