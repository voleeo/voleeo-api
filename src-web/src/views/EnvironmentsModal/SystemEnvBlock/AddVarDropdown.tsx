import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SearchField } from "@/components/SearchField"

export function AddVarDropdown({
  pos,
  candidates,
  anchorRef,
  onAdd,
  onClose,
}: {
  pos: { top: number; right: number }
  candidates: string[]
  anchorRef: RefObject<HTMLButtonElement | null>
  onAdd: (name: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchorRef.current?.contains(target))
        return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose, anchorRef])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q
      ? candidates.filter((c) => c.toLowerCase().includes(q))
      : candidates
  }, [candidates, query])

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", top: pos.top, right: pos.right }}
      className="z-[9999] w-[280px] rounded-[6px] border border-border bg-bg shadow-lg overflow-hidden"
    >
      <div className="p-1.5 border-b border-border">
        <SearchField value={query} onChange={setQuery} autoFocus />
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-2.5 py-2 font-sans text-[0.786rem] text-muted/60">
            No matching variables
          </div>
        )}
        {filtered.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onAdd(name)}
            className="w-full flex items-center px-2.5 py-[5px] border-0 outline-none cursor-pointer bg-transparent hover:bg-subtle text-left transition-colors"
          >
            <span className="font-mono text-[0.786rem] text-fg truncate">
              {name}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
