import { Circle, Colorful } from "@uiw/react-color"
import { useEffect, useRef } from "react"

// Palette-aligned presets; no color math is done on these by the library.
const PRESET_COLORS = [
  "var(--base08)",
  "var(--base09)",
  "var(--base0A)",
  "var(--base0B)",
  "var(--base0C)",
  "var(--base0D)",
  "var(--base0E)",
  "var(--base0F)",
]

interface Props {
  color: string
  /** anchor rect — the popover positions itself relative to this */
  anchorRect: DOMRect
  onChange: (hex: string) => void
  onClose: () => void
}

export function ColorPickerPopover({
  color,
  anchorRect,
  onChange,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [onClose])

  const GAP = 6
  const top = anchorRect.bottom + GAP
  const rawLeft = anchorRect.left
  // Panel is ~220px wide; keep it inside the viewport
  const left = Math.min(rawLeft, window.innerWidth - 228)

  return (
    <div
      ref={panelRef}
      className="fixed z-500 bg-surface border border-border rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-3 flex flex-col gap-3"
      style={{ top, left, width: 220 }}
    >
      <Circle
        colors={PRESET_COLORS}
        color={color}
        onChange={(c) => onChange(c.hex)}
        pointProps={{
          style: { width: 18, height: 18 },
        }}
        style={{ gap: 6, justifyContent: "center" }}
      />

      <Colorful
        color={color}
        disableAlpha
        onChange={(c) => onChange(c.hex)}
        style={{ width: "100%", borderRadius: 6 }}
      />

      <div className="flex items-center gap-2">
        <span
          className="w-5 h-5 rounded-full shrink-0 border border-border"
          style={{ background: color }}
        />
        <input
          value={color.toUpperCase()}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
          }}
          spellCheck={false}
          className="font-mono text-[0.857rem] text-fg bg-bg border border-border rounded-[4px] px-2 py-1 outline-none focus:border-accent flex-1 select-text min-w-0"
          maxLength={7}
        />
      </div>
    </div>
  )
}
