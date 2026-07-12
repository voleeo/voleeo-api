import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { useRowFlash } from "@/hooks/useRowFlash"

export function SystemEnvRow({
  name,
  value,
  onRemove,
  flash = false,
  flashNonce,
}: {
  name: string
  value: string | null
  onRemove: (name: string) => void
  flash?: boolean
  flashNonce?: number
}) {
  const [revealed, setRevealed] = useState(false)
  const flashRef = useRowFlash<HTMLDivElement>(flash, flashNonce)

  return (
    <div
      ref={flashRef}
      className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-2.5 py-[5px] border-b border-border/40 last:border-b-0"
    >
      <span className="font-mono text-[0.786rem] text-fg truncate">{name}</span>
      {value === null ? (
        <span
          className="font-sans text-[0.786rem] text-warn/80 italic truncate"
          title="Not present in the shell environment snapshot — restart Voleeo after exporting it."
        >
          missing
        </span>
      ) : (
        <span className="font-mono text-[0.786rem] text-muted truncate">
          {revealed ? value : "•••••••••"}
        </span>
      )}
      <span className="flex items-center gap-0.5">
        {value !== null && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            title={revealed ? "Hide value" : "Reveal value"}
            className="flex items-center p-1 border-0 outline-none cursor-pointer bg-transparent text-muted hover:text-fg transition-colors"
          >
            <Glyph
              kind={revealed ? "hide" : "view"}
              size={12}
              color="currentColor"
            />
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(name)}
          title="Remove from allowlist"
          className="flex items-center p-1 border-0 outline-none cursor-pointer bg-transparent text-muted hover:text-error transition-colors"
        >
          <Glyph kind="x" size={12} color="currentColor" />
        </button>
      </span>
    </div>
  )
}
